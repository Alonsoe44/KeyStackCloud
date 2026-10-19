#!/usr/bin/env python3
"""Run a local native-browser AAC-LC/M4A playback acceptance test.

The runner owns only temporary Mac-local data:

* PCM fixtures are created with Python and encoded by local ffmpeg, or by the
  explicitly selected Docker FFmpeg image when native ffmpeg is unavailable.
* The existing compiled SongStreamer API is started against a temporary
  database and audio root.
* A temporary test page is served on another loopback port.

The browser step is deliberately interactive: open the printed page URL in
the installed Chrome and click the test button. The page posts its structured
result back to the runner, which then cleans up the temporary API and files.
"""

from __future__ import annotations

import argparse
import http.server
import json
import math
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path
from typing import Any


SCRIPT_PATH = Path(__file__).resolve()
REPO_ROOT = SCRIPT_PATH.parent.parent
DEFAULT_REPORT = REPO_ROOT / "docs" / "local-browser-results.md"
API_READY_TIMEOUT = 20.0
RUNNER_TIMEOUT = 180.0
DEFAULT_FFMPEG_IMAGE = (
    "jrottenberg/ffmpeg@sha256:"
    "c06893d3ea50fc2aceccec63fc21df415124f99164eb16c56ce2e8bb88342a08"
)

FIXTURE_SPECS = [
    {
        "id": "local-aac-44k1",
        "filename": "aac-lc-44k1.m4a",
        "sample_rate": 44100,
        "bitrate": 128000,
        "frequency": 440,
        "duration": 8.0,
        "title": "Local AAC 44.1 kHz",
    },
    {
        "id": "local-aac-48k",
        "filename": "aac-lc-48k.m4a",
        "sample_rate": 48000,
        "bitrate": 192000,
        "frequency": 660,
        "duration": 8.0,
        "title": "Local AAC 48 kHz",
    },
]


PAGE_TEMPLATE = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>SongStreamer local AAC-LC acceptance test</title>
  <style>
    body { font: 16px system-ui, sans-serif; max-width: 70rem; margin: 2rem auto; padding: 0 1rem; color: #222; }
    button { font-size: 1.1rem; padding: .65rem 1rem; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f5f5f5; padding: 1rem; }
  </style>
</head>
<body>
  <h1>SongStreamer local AAC-LC/M4A test</h1>
  <p id="state">Click the button to start a real user gesture.</p>
  <button id="run" type="button">Run playback and seek test</button>
  <pre id="report"></pre>
  <script>
  (function () {
    "use strict";
    var API_BASE = "__API_BASE__";
    var FIXTURES = __FIXTURES_JSON__;
    var MIME = 'audio/mp4; codecs="mp4a.40.2"';
    var button = document.getElementById("run");
    var state = document.getElementById("state");
    var output = document.getElementById("report");
    var report = {
      status: "waiting",
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      apiBase: API_BASE,
      mime: MIME,
      canPlayType: "",
      fixtures: [],
      notes: [
        "Web Audio analyser energy proves decoded samples reached the browser audio graph.",
        "Physical speaker audibility requires a human listener or separate audio-sink instrumentation."
      ]
    };
    window.__localAudioReport = report;

    function show() {
      window.__localAudioReport = report;
      output.textContent = JSON.stringify(report, null, 2);
    }

    function waitFor(target, name, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var timer = setTimeout(function () {
          target.removeEventListener(name, onEvent);
          reject(new Error("Timed out waiting for " + name));
        }, timeoutMs);
        function onEvent(event) {
          clearTimeout(timer);
          target.removeEventListener(name, onEvent);
          resolve(event);
        }
        target.addEventListener(name, onEvent, { once: true });
      });
    }

    function waitUntil(predicate, timeoutMs, label) {
      return new Promise(function (resolve, reject) {
        var started = performance.now();
        function tick() {
          var value = false;
          try { value = predicate(); } catch (error) {}
          if (value) return resolve(value);
          if (performance.now() - started >= timeoutMs) {
            return reject(new Error("Timed out waiting for " + label));
          }
          setTimeout(tick, 40);
        }
        tick();
      });
    }

    function errorDetails(audio) {
      if (!audio.error) return null;
      return {
        code: audio.error.code,
        message: audio.error.message || "",
        networkState: audio.networkState,
        readyState: audio.readyState
      };
    }

    function attachEvents(audio) {
      var events = [];
      [
        "loadstart", "loadedmetadata", "loadeddata", "canplay", "playing",
        "pause", "seeking", "seeked", "stalled", "waiting", "ended", "error"
      ].forEach(function (name) {
        audio.addEventListener(name, function () {
          events.push({
            name: name,
            currentTime: Number(audio.currentTime.toFixed(4)),
            readyState: audio.readyState,
            networkState: audio.networkState,
            error: errorDetails(audio)
          });
        });
      });
      return events;
    }

    function rms(analyser) {
      var values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      var sum = 0;
      for (var i = 0; i < values.length; i += 1) sum += values[i] * values[i];
      return Math.sqrt(sum / values.length);
    }

    async function waitForEnergy(analyser, timeoutMs) {
      var started = performance.now();
      var maximum = 0;
      while (performance.now() - started < timeoutMs) {
        var value = rms(analyser);
        if (value > maximum) maximum = value;
        if (value > 0.0005) return { detected: true, maximumRms: value };
        await new Promise(function (resolve) { setTimeout(resolve, 50); });
      }
      return { detected: false, maximumRms: maximum };
    }

    async function apiJson(path) {
      var response = await fetch(API_BASE + path);
      var body = await response.json();
      if (!response.ok) throw new Error(path + " returned " + response.status);
      return { status: response.status, body: body };
    }

    async function rangeProbe(url) {
      var response = await fetch(url, { headers: { Range: "bytes=0-127" } });
      var body = await response.arrayBuffer();
      return {
        status: response.status,
        contentRange: response.headers.get("Content-Range"),
        contentLength: response.headers.get("Content-Length"),
        acceptRanges: response.headers.get("Accept-Ranges"),
        bytesRead: body.byteLength
      };
    }

    async function seekAndResume(audio, target, label) {
      audio.pause();
      var seeked = waitFor(audio, "seeked", 6000);
      audio.currentTime = target;
      await seeked;
      var landed = audio.currentTime;
      await audio.play();
      await waitUntil(function () {
        return !audio.paused && audio.currentTime >= landed + 0.15;
      }, 4000, label + " resume");
      return {
        requested: Number(target.toFixed(4)),
        landed: Number(landed.toFixed(4)),
        resumedAt: Number(audio.currentTime.toFixed(4))
      };
    }

    async function testFixture(spec, audioContext) {
      var detail = await apiJson("/songs/" + encodeURIComponent(spec.id));
      var audioUrl = API_BASE + "/songs/" + encodeURIComponent(spec.id) + "/audio";
      var audio = document.createElement("audio");
      audio.crossOrigin = "anonymous";
      audio.preload = "auto";
      audio.src = audioUrl;
      document.body.appendChild(audio);
      var events = attachEvents(audio);
      var result = {
        id: spec.id,
        title: detail.body.title,
        expectedSampleRate: spec.sample_rate,
        expectedBitrate: spec.bitrate,
        metadataStatus: detail.status,
        metadataDuration: detail.body.duration,
        canPlayType: audio.canPlayType(MIME),
        duration: null,
        playbackAdvanced: false,
        advancedTo: null,
        pauseObserved: false,
        resumeAdvanced: false,
        seekForward: null,
        seekBackward: null,
        seekNearEnd: null,
        ended: false,
        decodedAudioEnergy: null,
        rangeProbe: null,
        mediaError: null,
        events: events
      };
      var source = audioContext.createMediaElementSource(audio);
      var analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyser.connect(audioContext.destination);
      audio.load();
      var metadata = waitFor(audio, "loadedmetadata", 10000);
      var play = audio.play();
      await play;
      await metadata;
      result.duration = Number(audio.duration.toFixed(4));
      if (!isFinite(audio.duration) || audio.duration <= 0) {
        throw new Error("Invalid duration for " + spec.id);
      }
      await waitUntil(function () { return audio.currentTime > 0.35; }, 5000, spec.id + " playback");
      result.advancedTo = Number(audio.currentTime.toFixed(4));
      result.playbackAdvanced = result.advancedTo > 0.35;
      var energy = waitForEnergy(analyser, 4000);
      audio.pause();
      result.pauseObserved = audio.paused;
      var pausedAt = audio.currentTime;
      await audio.play();
      await waitUntil(function () { return audio.currentTime > pausedAt + 0.15; }, 4000, spec.id + " resume");
      result.resumeAdvanced = true;
      result.decodedAudioEnergy = await energy;
      result.seekForward = await seekAndResume(
        audio,
        Math.min(result.duration * 0.58, result.duration - 1),
        "forward seek"
      );
      result.seekBackward = await seekAndResume(
        audio,
        Math.max(result.duration * 0.22, 0.5),
        "backward seek"
      );
      result.seekNearEnd = await seekAndResume(
        audio,
        Math.max(result.duration - 0.55, 0.5),
        "near-end seek"
      );
      await waitFor(audio, "ended", 5000);
      result.ended = true;
      result.mediaError = errorDetails(audio);
      result.rangeProbe = await rangeProbe(audioUrl);
      audio.pause();
      audio.remove();
      return result;
    }

    async function postReport() {
      try {
        await fetch("/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(report)
        });
      } catch (error) {
        report.postError = String(error);
      }
      show();
    }

    button.addEventListener("click", async function () {
      button.disabled = true;
      state.textContent = "Running against the local SongStreamer API…";
      report.status = "running";
      report.canPlayType = document.createElement("audio").canPlayType(MIME);
      show();
      try {
        var audioContext = new AudioContext();
        await audioContext.resume();
        for (var i = 0; i < FIXTURES.length; i += 1) {
          report.fixtures.push(await testFixture(FIXTURES[i], audioContext));
          show();
        }
        await audioContext.close();
        report.status = "pass";
        report.completed = true;
        state.textContent = "Completed";
      } catch (error) {
        report.status = "fail";
        report.completed = true;
        report.failure = String(error && error.stack ? error.stack : error);
        state.textContent = "Failed";
      }
      await postReport();
    });
    show();
  }());
  </script>
</body>
</html>
"""


def reserve_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])
    finally:
        sock.close()


def command_output(argv: list[str], timeout: float = 8.0) -> str:
    try:
        completed = subprocess.run(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return str(error)
    return completed.stdout.strip()


def write_pcm_fixture(root: Path, spec: dict[str, Any]) -> Path:
    wav_path = root / (spec["id"] + ".wav")
    sample_rate = int(spec["sample_rate"])
    frame_count = int(round(sample_rate * float(spec["duration"])))
    frequency = float(spec["frequency"])
    amplitude = 0.22
    with wave.open(str(wav_path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        block_size = 4096
        for block_start in range(0, frame_count, block_size):
            frames = min(block_size, frame_count - block_start)
            values: list[int] = []
            for offset in range(frames):
                sample = int(
                    32767
                    * amplitude
                    * math.sin(
                        2.0
                        * math.pi
                        * frequency
                        * (block_start + offset)
                        / sample_rate
                    )
                )
                values.extend((sample, sample))
            output.writeframes(struct.pack("<" + "h" * len(values), *values))
    return wav_path


def encode_fixture(root: Path, spec: dict[str, Any]) -> dict[str, Any]:
    afinfo = shutil.which("afinfo")
    if not afinfo:
        raise RuntimeError("macOS afinfo is required to validate the fixture")
    wav_path = write_pcm_fixture(root, spec)
    m4a_path = root / "audio" / spec["filename"]
    native_ffmpeg = shutil.which("ffmpeg")
    if native_ffmpeg:
        encode_command = [
            native_ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(wav_path),
            "-c:a",
            "aac",
            "-profile:a",
            "aac_low",
            "-b:a",
            str(spec["bitrate"]),
            "-movflags",
            "+faststart",
            str(m4a_path),
        ]
        encoder = "native ffmpeg"
    else:
        image = os.environ.get("LOCAL_AUDIO_FFMPEG_IMAGE", DEFAULT_FFMPEG_IMAGE)
        # Mount only this temporary fixture root. The container never gets the
        # repository, browser profile, or any persistent host directory.
        encode_command = [
            "docker",
            "run",
            "--rm",
            "-v",
            "{}:/work".format(root),
            "-w",
            "/work",
            image,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            wav_path.name,
            "-c:a",
            "aac",
            "-profile:a",
            "aac_low",
            "-b:a",
            str(spec["bitrate"]),
            "-movflags",
            "+faststart",
            "audio/{}".format(spec["filename"]),
        ]
        encoder = "Docker FFmpeg image {}".format(image)
    converted = subprocess.run(
        encode_command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=60,
        check=False,
    )
    if converted.returncode != 0:
        raise RuntimeError(
            "{} failed: {}".format(
                encoder, converted.stderr.strip() or converted.stdout.strip()
            )
        )
    info = command_output([afinfo, "-r", str(m4a_path)], timeout=10)
    brief = command_output([afinfo, "-b", str(m4a_path)], timeout=10)
    return {
        **spec,
        "path": str(m4a_path),
        "afinfoBrief": brief,
        "afinfo": info,
        "size": m4a_path.stat().st_size,
        "encoder": encoder,
    }


def wait_for_health(url: str, process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + API_READY_TIMEOUT
    last_error = ""
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = process.stderr.read().decode("utf-8", errors="replace") if process.stderr else ""
            raise RuntimeError("API exited before health: " + stderr[-2000:])
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError) as error:
            last_error = str(error)
        time.sleep(0.2)
    raise RuntimeError("Timed out waiting for API health: " + last_error)


class TestPageServer(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], page: bytes):
        super().__init__(address, TestPageHandler)
        self.page = page
        self.report: dict[str, Any] | None = None


class TestPageHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        if self.path.split("?", 1)[0] in {"/", "/index.html"}:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(self.server.page)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(self.server.page)
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if self.path != "/report":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            self.server.report = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            self.send_error(400, str(error))
            return
        self.send_response(204)
        self.end_headers()


def run_library_add(
    root: Path,
    fixture: dict[str, Any],
) -> None:
    environment = {
        **os.environ,
        "DB_PATH": str(root / "data" / "songstreamer.sqlite"),
        "AUDIO_ROOT": str(root / "audio"),
        "MIGRATIONS_DIR": str(REPO_ROOT / "migrations"),
    }
    command = [
        "node",
        str(REPO_ROOT / "scripts" / "library.mjs"),
        "add",
        "--id",
        fixture["id"],
        "--title",
        fixture["title"],
        "--artist",
        "Local Browser Test",
        "--duration",
        str(fixture["duration"]),
        "--file",
        fixture["filename"],
    ]
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        env=environment,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=20,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError("library add failed: " + completed.stderr.strip())


def render_report(
    ready: dict[str, Any],
    report: dict[str, Any] | None,
    runner_error: str | None,
) -> str:
    tick = chr(96)
    if report and report.get("status") == "pass" and not runner_error:
        status = "PASS"
    elif report is None:
        status = "INCONCLUSIVE"
    else:
        status = "FAIL"
    rows: list[str] = []
    if report:
        for fixture in report.get("fixtures", []):
            energy = fixture.get("decodedAudioEnergy") or {}
            seek = fixture.get("seekNearEnd") or {}
            rows.append(
                "| {}{}{} | {} | {} | {} | {} | {} | {} | {} ({:.6f}) |".format(
                    tick,
                    fixture.get("id", ""),
                    tick,
                    fixture.get("canPlayType", ""),
                    fixture.get("metadataStatus", ""),
                    fixture.get("duration", ""),
                    fixture.get("playbackAdvanced", ""),
                    bool(fixture.get("pauseObserved") and fixture.get("resumeAdvanced")),
                    seek.get("landed", ""),
                    bool(energy.get("detected", False)),
                    float(energy.get("maximumRms", 0)),
                )
            )
    lines = [
        "# Local browser AAC-LC playback evidence",
        "",
        "Status: **{}**.".format(status),
        "",
        "This test used the local Mac SongStreamer API against a temporary SQLite "
        "library and temporary AAC-LC M4A files. Chrome was "
        "driven through a real button click; no frontend product code was used.",
        "",
        "## Environment",
        "",
        format_json_block(ready),
        "",
        "## Playback observations",
        "",
        "| Fixture | canPlayType | Metadata status | Duration (s) | Time advanced | Pause/resume | Near-end seek landed (s) | Web Audio energy |",
        "| --- | --- | ---: | ---: | --- | --- | ---: | --- |",
    ]
    lines.extend(rows or ["| No fixture result | | | | | | | |"])
    lines.extend(
        [
            "",
            "The page performed metadata loading, real play, currentTime advancement, "
            "pause/resume, forward seek, backward seek, near-end seek, ended, and an "
            "explicit Range request for each API audio route.",
            "",
            "A nonzero Web Audio RMS value proves decoded samples reached the browser "
            "audio graph. It does not prove physical speaker audibility; that requires "
            "a human listener or separate audio-sink instrumentation.",
            "",
            "## Structured page result",
            "",
            format_json_block({"report": report, "runnerError": runner_error}),
            "",
            "Temporary API process, browser page server, database, and audio files "
            "were cleaned up automatically after the browser report or timeout.",
            "",
        ]
    )
    return "\n".join(lines)


def format_json_block(value: Any) -> str:
    fence = chr(96) * 3
    return "{}json\n{}\n{}".format(
        fence,
        json.dumps(value, indent=2, sort_keys=True),
        fence,
    )


def runner(args: argparse.Namespace) -> int:
    root = Path(tempfile.mkdtemp(prefix="songstreamer-local-audio-", dir="/tmp"))
    api_process: subprocess.Popen[bytes] | None = None
    page_server: TestPageServer | None = None
    page_thread: threading.Thread | None = None
    runner_error: str | None = None
    ready: dict[str, Any] = {}
    try:
        (root / "audio").mkdir(parents=True)
        (root / "data").mkdir(parents=True)
        fixtures = [encode_fixture(root, spec) for spec in FIXTURE_SPECS]
        for fixture in fixtures:
            run_library_add(root, fixture)
        api_port = reserve_port()
        api_base = "http://127.0.0.1:{}".format(api_port)
        api_environment = {
            **os.environ,
            "HOST": "127.0.0.1",
            "PORT": str(api_port),
            "DATA_ROOT": str(root / "data"),
            "AUDIO_ROOT": str(root / "audio"),
            "DB_PATH": str(root / "data" / "songstreamer.sqlite"),
            "MIGRATIONS_DIR": str(REPO_ROOT / "migrations"),
            "REQUIRE_SSD_MARKER": "false",
            "CORS_ORIGIN": "*",
            "LOG_LEVEL": "silent",
        }
        main_path = REPO_ROOT / "dist" / "src" / "main.js"
        if not main_path.is_file():
            raise RuntimeError("Compiled API missing: run npm run build first")
        api_process = subprocess.Popen(
            ["node", str(main_path)],
            cwd=REPO_ROOT,
            env=api_environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        wait_for_health(api_base + "/health", api_process)
        fixture_specs = [
            {
                key: value
                for key, value in fixture.items()
                if key in {"id", "filename", "sample_rate", "bitrate", "frequency", "duration"}
            }
            for fixture in fixtures
        ]
        page = PAGE_TEMPLATE.replace("__API_BASE__", api_base).replace(
            "__FIXTURES_JSON__",
            json.dumps(fixture_specs, separators=(",", ":")),
        ).encode("utf-8")
        page_server = TestPageServer(("127.0.0.1", 0), page)
        page_thread = threading.Thread(target=page_server.serve_forever, daemon=True)
        page_thread.start()
        page_port = int(page_server.server_address[1])
        ready = {
            "apiBase": api_base,
            "pageUrl": "http://127.0.0.1:{}/".format(page_port),
            "fixtures": fixtures,
            "macOS": command_output(["sw_vers", "-productVersion"]),
            "architecture": command_output(["uname", "-m"]),
            "chromeBundleVersion": command_output(
                ["mdls", "-name", "CFBundleShortVersionString", "-raw", "/Applications/Google Chrome.app"]
            ),
            "apiPid": api_process.pid,
        }
        print("READY " + json.dumps(ready, separators=(",", ":")), flush=True)
        deadline = time.monotonic() + args.timeout
        while page_server.report is None and time.monotonic() < deadline:
            if api_process.poll() is not None:
                raise RuntimeError("API stopped before browser report")
            time.sleep(0.2)
        if page_server.report is None:
            runner_error = "Timed out waiting for browser report"
    except Exception as error:
        runner_error = str(error)
    finally:
        if page_server is not None and page_server.report is None and runner_error is None:
            runner_error = "Stopped before browser report"
        if api_process is not None and api_process.poll() is None:
            api_process.terminate()
            try:
                api_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                api_process.kill()
                api_process.wait(timeout=5)
        if page_server is not None:
            page_server.shutdown()
            page_server.server_close()
        if page_thread is not None:
            page_thread.join(timeout=3)
        report_path = Path(args.report)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            render_report(ready, None if page_server is None else page_server.report, runner_error),
            encoding="utf-8",
        )
        shutil.rmtree(root, ignore_errors=True)
        print(
            "DONE "
            + json.dumps(
                {
                    "report": str(report_path.resolve()),
                    "pageReport": None if page_server is None else page_server.report,
                    "runnerError": runner_error,
                },
                separators=(",", ":"),
            ),
            flush=True,
        )
    return 0 if runner_error is None and page_server is not None and page_server.report is not None else 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", default=str(DEFAULT_REPORT))
    parser.add_argument("--timeout", type=float, default=RUNNER_TIMEOUT)
    return parser.parse_args()


if __name__ == "__main__":
    raise SystemExit(runner(parse_args()))
