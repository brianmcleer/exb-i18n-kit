"""
opus-mt-server.py  -  a tiny LibreTranslate-compatible server for the languages LibreTranslate
does not have, so the memory workflow can fill them the same way.

  Bosnian (bs), Croatian (hr), Serbian Latin (sr): Helsinki-NLP/opus-mt-tc-base-en-sh
  (one English to Serbo-Croatian model; the target variant is picked with a >>xxx<< token).
  License of the model: CC-BY-4.0. Runs on CPU on the GitHub runner.

  GET  /languages   -> [{"code": "en", "targets": ["bs", "hr", "sr"]}, ...]
  POST /translate   {"q": [...] | "...", "source": "en", "target": "bs", "format": "html"}
                    -> {"translatedText": [...] | "..."}

The kit wraps {placeholders} as <x id="n"></x> (format html). Marian models handle that
poorly, so they become [n] here and go back after; the kit rejects any translation whose
placeholders came back wrong, so a damaged one stays untranslated instead of shipping broken.

  python tools/opus-mt-server.py --port 5001
"""
import argparse
import html
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from transformers import MarianMTModel, MarianTokenizer

MODEL = "Helsinki-NLP/opus-mt-tc-base-en-sh"
TOKENS = {"bs": ">>bos_Latn<<", "hr": ">>hrv<<", "sr": ">>srp_Latn<<"}
TAG = re.compile(r'<x\s+id="?(\d+)"?\s*(?:/>|></x>|>)')

tokenizer = MarianTokenizer.from_pretrained(MODEL)
model = MarianMTModel.from_pretrained(MODEL)
model.eval()


def to_plain(text):
    return html.unescape(TAG.sub(lambda m: "[" + m.group(1) + "]", text))


def to_html(text):
    out = html.escape(text, quote=False)
    return re.sub(r"\[\s*(\d+)\s*\]", lambda m: '<x id="' + m.group(1) + '"></x>', out)


def translate(texts, target, batch=16):
    token = TOKENS[target]
    out = []
    for i in range(0, len(texts), batch):
        chunk = [token + " " + to_plain(t) for t in texts[i:i + batch]]
        enc = tokenizer(chunk, return_tensors="pt", padding=True, truncation=True, max_length=512)
        gen = model.generate(**enc, num_beams=4, max_new_tokens=512)
        out.extend(to_html(s) for s in tokenizer.batch_decode(gen, skip_special_tokens=True))
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path.rstrip("/") == "/languages":
            return self._send(200, [{"code": "en", "name": "English", "targets": sorted(TOKENS)}] +
                              [{"code": c, "name": c, "targets": ["en"]} for c in sorted(TOKENS)])
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/translate":
            return self._send(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))) or b"{}")
            target = req.get("target")
            if req.get("source", "en") != "en" or target not in TOKENS:
                return self._send(400, {"error": "unsupported language pair"})
            q = req.get("q")
            many = isinstance(q, list)
            texts = q if many else [q]
            res = translate([str(t) for t in texts], target)
            self._send(200, {"translatedText": res if many else res[0]})
        except Exception as e:  # keep serving; the kit treats a failed batch as untranslated
            self._send(500, {"error": str(e)[:200]})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=5001)
    args = ap.parse_args()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
