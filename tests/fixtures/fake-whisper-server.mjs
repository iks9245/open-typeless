#!/usr/bin/env node
/**
 * Stand-in for whisper.cpp's whisper-server in tests.
 * Accepts the same arguments, waits FAKE_DELAY_MS (default 300) before listening on
 * 127.0.0.1:<--port>, answers GET with 200 and POST /inference with FAKE_TEXT.
 * Writes its arguments to FAKE_ARGS_FILE when set; exits with code 1
 * FAKE_EXIT_AFTER_MS after listening when set.
 */

import http from 'node:http';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
if (process.env.FAKE_ARGS_FILE) writeFileSync(process.env.FAKE_ARGS_FILE, JSON.stringify(args));
const port = Number(args[args.indexOf('--port') + 1]);

setTimeout(() => {
  http.createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200);
      res.end('ok');
      return;
    }
    req.resume();
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ text: process.env.FAKE_TEXT ?? 'hello' }));
    });
  }).listen(port, '127.0.0.1', () => {
    console.log(`fake whisper-server listening on ${port}`);
    // Simulate a crash this long after becoming ready
    if (process.env.FAKE_EXIT_AFTER_MS) setTimeout(() => process.exit(1), Number(process.env.FAKE_EXIT_AFTER_MS));
  });
}, Number(process.env.FAKE_DELAY_MS ?? 300));
