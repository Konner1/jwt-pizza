"""Send steady traffic to the load balancer and record who answered each request.
usage: python3 client.py URL [--duration 30] [--rate 10] [--csv out.csv]
"""
import argparse, csv, json, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

p = argparse.ArgumentParser()
p.add_argument("url"); p.add_argument("--duration", type=float, default=30)
p.add_argument("--rate", type=float, default=10, help="requests per second")
p.add_argument("--csv")
a = p.parse_args()
t0 = time.time(); rows = []

def hit(i):
    start = time.time()
    try:
        with urllib.request.urlopen(a.url, timeout=10) as r:
            server = json.load(r)["server"]
            tried = r.headers.get("X-Upstream-Addr", "")
            status = r.status
    except Exception as e:
        server, tried, status = "-", "", type(e).__name__
    lat = time.time() - start
    row = (i, round(start - t0, 2), status, server, len(tried.split(",")), round(lat, 3))
    rows.append(row)
    print(f"t={row[1]:6.2f}s  #{i:<4} status={status}  server={server:<5} servers_tried={row[4]}  latency={lat*1000:6.0f}ms")

n = int(a.duration * a.rate)
with ThreadPoolExecutor(max_workers=50) as ex:
    for i in range(n):
        ex.submit(hit, i)
        time.sleep(1 / a.rate)
rows.sort()

print("\n=== SUMMARY ===")
print("total requests:", len(rows))
print("failed requests (client saw an error):", sum(r[2] != 200 for r in rows))
print("requests that needed a retry on another server:", sum(r[4] > 1 for r in rows))
print("max latency: %.0f ms" % (max(r[5] for r in rows) * 1000))
for s in sorted({r[3] for r in rows}):
    mine = [r for r in rows if r[3] == s]
    print(f"{s:>5}: {len(mine):4} requests   first seen t={mine[0][1]}s   last seen t={mine[-1][1]}s")
if a.csv:
    with open(a.csv, "w", newline="") as f:
        w = csv.writer(f); w.writerow(["i", "t", "status", "server", "servers_tried", "latency_s"]); w.writerows(rows)
