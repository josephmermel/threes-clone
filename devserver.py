#!/usr/bin/env python3
"""Local dev server for this directory that disables caching entirely.

Plain `python -m http.server` sends no Cache-Control header, and browsers
(this one included) end up caching JS/CSS aggressively across navigations
anyway via heuristic freshness - edits then silently don't show up on
reload. This adds `Cache-Control: no-store` to every response so a normal
reload always gets the current file straight off disk.
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    # Serve this script's own directory regardless of the caller's cwd.
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8935
    http.server.test(HandlerClass=NoCacheHandler, port=port)
