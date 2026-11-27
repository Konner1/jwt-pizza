# Curiosity Report: How Load Balancers Keep an Application Up When a Server Dies

## Why I looked into this

In my CS 452 class we talked about how companies have multiple servers and backups that contain all the information. I wanted to understand how the servers worked together to hold all of the information without it losing anything when one went down. You can also see the different locations for servers in AWS and I wondered how information was shared in different locations and why that mattered. 

**Central question:** If a company runs an application on three servers and one suddenly crashes, how does the infrastructure notice, redirect traffic, and keep the app running without a human stepping in?

## Background

### 1. Load balancing
A load balancer is a single front door. Clients talk only to it, and it forwards each request to one of several identical servers.

- **Round robin** takes the servers in turn (1, 2, 3, 1, 2, 3...). It is simple and fair by request count, but it ignores how busy each server is.
- **Least connections** sends the request to the server with the fewest in-flight requests. It adapts when servers are slower or requests vary in cost.

### 2. Health checks
- **Active checks:** the balancer polls something like `/health` on a schedule. It marks a server unhealthy after N failures and healthy again after M successes. AWS Elastic Load Balancing does this.
- **Passive checks:** the balancer watches real traffic and marks a server down when real requests to it fail. Open-source NGINX supports only passive checks (`max_fails` / `fail_timeout`). Active `health_check` is an NGINX Plus feature [2].

### 3. Failover
Failover happens at two layers:
- **Per request:** if the connection to a server fails or times out, NGINX retries the same request on another server (`proxy_next_upstream`). The user never sees the error.
- **Per server:** after `max_fails` failures within `fail_timeout`, NGINX stops sending that server traffic for `fail_timeout` seconds [2].

### 4. Recovery
A passive balancer can't know a server is back until it tries it. When the `fail_timeout` window ends, a live request acts as the probe. If it succeeds, the server rejoins. If it fails, the timer resets. Active checks recover by counting consecutive passing polls.

## The lab (reproducible)

Everything is in `lb-lab/`:

| File | Purpose |
|---|---|
| `app/app.py`, `app/Dockerfile` | Tiny Python HTTP server that replies `{"server": "<name>"}`, with a configurable artificial delay. It also serves `/health`. |
| `docker-compose.yml` | 3 app containers plus 2 NGINX load balancers. Round robin is on `:8080` and least connections is on `:8081`. |
| `nginx.rr.conf`, `nginx.lc.conf` | The two load balancer configs. They are identical except for `least_conn;`. |
| `client.py` | Sends steady traffic and logs which server answered each request, the latency, and how many servers NGINX tried (from the `X-Upstream-Addr` header). |
| `results/` | Raw CSV and log output from the runs below. |

Key settings in the NGINX config:
```nginx
server app1:8000 max_fails=1 fail_timeout=10s;   # passive health check
proxy_connect_timeout 1s;                         # how long to wait on a dead server
proxy_next_upstream error timeout;                # retry on another server on failure
proxy_next_upstream_tries 3;
add_header X-Upstream-Addr $upstream_addr always; # exposes every server tried
```
I made **app1 deliberately slow (300 ms vs 20 ms for app2 and app3)** so the two algorithms would behave differently.

**To reproduce**
```bash
cd lb-lab
docker compose up -d --build
python3 client.py http://localhost:8080/ --duration 15 --csv results/exp1_round_robin.csv   # Experiment 1
python3 client.py http://localhost:8081/ --duration 15 --csv results/exp1_least_conn.csv
# Experiment 2: in terminal A
python3 client.py http://localhost:8080/ --duration 45 --csv results/exp2_failure_recovery.csv
# in terminal B: docker stop lb-lab-app2-1 at ~10s, then docker start lb-lab-app2-1 at ~30s
docker compose down
```

## Experiment 1: normal operation (150 requests each, 10 req/s)

| Algorithm | app1 (slow) | app2 | app3 |
|---|---|---|---|
| Round robin | 50 | 50 | 50 |
| Least connections | 29 | 61 | 60 |

Round robin split the traffic evenly even though app1 was 15x slower. Least connections sent app1 about half as much, because its requests stayed in flight longer, so it was "busier" more often. Round robin is fair by count. Least connections is fair by load.

## Experiment 2: failure and recovery (45 s, 10 req/s, round robin)

I stopped app2 at about t=10 s and restarted it at about t=30 s.

| Measurement | Result |
|---|---|
| Requests where the client saw an error | **0 of 450** (every response was HTTP 200) |
| Last response from app2 before the crash | t = 9.71 s |
| Requests that needed a retry on another server | 5 |
| Latency of retried requests | about 1.0 to 1.3 s (normal is 20 to 300 ms) |
| app2's first response after the restart | t = 34.82 s |

What happened, step by step (see `results/exp2_failure_recovery.csv`):

1. **Detection (t = 10.0 s).** The first request routed to dead app2 waited out the 1 s `proxy_connect_timeout`, then NGINX retried it on another server. The client got a 200, just about 1 s late. Three more requests (t = 10.33, 10.63, 10.94) were already headed to app2 and paid the same penalty before app2 was marked down. The app1 retries show about 1.3 s, which is the 1 s timeout plus app1's 300 ms.
2. **Failover.** After that, app2 was out of rotation and its share went to app1 and app3. No more retries were needed.
3. **The probe (t = 22.86 s).** About 10 s later the `fail_timeout` window expired. NGINX tried app2 with a real request, which was still down, so that request paid the 1 s penalty too. The timer reset.
4. **Recovery.** app2 was restarted at about 30 s but didn't serve a request until 34.82 s. The passive check only tries a server once its window ends, so a restarted server waits for the next probe.

**Takeaway:** users saw no errors, but about 5 requests were noticeably slower. Detection and recovery times come from the config (`proxy_connect_timeout`, `max_fails`, `fail_timeout`), so they're tradeoffs. A short timeout detects faster but risks false alarms, and a long one is slower to react.

## How this compares to AWS Elastic Load Balancing

An AWS Application Load Balancer uses **active** health checks against each target group. From the AWS docs [1], the defaults are:

| Setting | Default |
|---|---|
| Interval | 30 s (instance and IP targets) |
| Unhealthy threshold | 2 consecutive failures |
| Healthy threshold | 5 consecutive successes |
| Success codes | 200 |

The timeout default is inconsistent in the AWS docs. The ELB health check page says 5 s for instance and IP targets, and the CloudFormation reference says 6 s for HTTP. I'm not citing one. With the defaults, a dead target takes roughly 2 x 30 = 60 s to be marked unhealthy, and a recovered one needs 5 x 30 = 150 s to be marked healthy again. That is deliberately conservative and much slower than my NGINX lab's ~1 s detection. The difference is that active checks don't depend on a user's request being the one that fails. 

| | NGINX (my lab) | AWS ALB (defaults) |
|---|---|---|
| Check type | Passive (real traffic) | Active (polls a health path) |
| Failure detection | First failed request (~1 s) | 2 failed polls at 30 s intervals |
| User impact during detection | A few slow requests (retried) | Depends on whether requests are retried |
| Recovery | Next probe after `fail_timeout` | 5 consecutive good polls |

## The big question: no human required

Nobody intervenes because each step is automatic:
- **Detection** comes from health checks or failed requests.
- **Rerouting** comes from retry plus removal from rotation.
- **Recovery** comes from a probe or a count of passing polls.

This only works if the servers are interchangeable, meaning no user state lives on any one server. If it does, you need shared storage (database, Redis) or sticky sessions.

## Limitations
- Single laptop, Docker networking, one trial per experiment. Timings would vary between runs.
- I only tested a clean crash (container stopped). A hung server that accepts connections but responds slowly would not trigger `proxy_next_upstream error timeout` the same way.
- NGINX Plus active checks and a real AWS ALB were not tested, only read about.

## What I learned
There's a lot that goes into managing servers so I just focused a a few small parts to help me better understand how the servers handle failuer and traffic. Using a load balancer (activing effectivly as a host at a resturant dealing with the chefs (servers)) systems are able to direct traffic using a round robin orderly way of dishing out requests while another method of finding the server with the least connections (or amount of work) is longer to implement but can get the work down faster. I did an expirament where I had 3 servers and one of them was slow while the other two were normal. Then I did the round robin sharing of the workload and the least connections. The least connections was faster and you could see that instead of all three servers handling the same amout of requests- the faster ones took on more.

I was also interested in how these servers fail and recover. Basically there are two ways of doing it- you can be active (and ask if the servers are ok) or passive (keep sending it and if it fails take the request back). I wanted to see if passive actually worked and how so I found a good expirement online to try where I sent traffic for 45 seconds and killed the second server from T10 to T30. What was cool was that none of the requests failed. The loadbalancer grabbed the requests from the server that it sent it to (it stored what was where until completed) and had them go to other servers. While the requests got slower by like a second per request for those 20 seconds nothing failed which was cool. It means that users don't see the failure. 

## References
1. AWS, [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
2. NGINX, [HTTP Health Checks](https://docs.nginx.com/nginx/admin-guide/load-balancer/http-health-check/)
3. NGINX, [ngx_http_upstream_module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html) (`max_fails`, `fail_timeout`) and [ngx_http_proxy_module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) (`proxy_next_upstream`)
