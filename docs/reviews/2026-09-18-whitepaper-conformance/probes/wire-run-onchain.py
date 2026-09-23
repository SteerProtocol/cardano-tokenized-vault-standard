"""Compile isolated Request recovery probes without modifying authored sources or .build."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

base = Path(__file__).resolve().parents[4]
probe = Path(__file__).resolve().parent
compiler = os.environ.get("AIKEN", "/tmp/ctvs-reference/aiken-aarch64-apple-darwin/aiken")
sources = []
with tempfile.TemporaryDirectory(prefix="ctvs-wire-review-") as name:
    temp = Path(name)
    for origin in [base / "reference/packages/onchain", base / "reference/implementations/ctvs2/onchain"]:
        for group in ["lib", "validators"]:
            for source in sorted((origin / group).rglob("*.ak")):
                if source.name.endswith("_test.ak") or "tests" in source.relative_to(origin).parts:
                    continue
                destination = temp / source.relative_to(origin)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if destination.exists():
                    raise RuntimeError(f"Duplicate module: {source}")
                shutil.copy2(source, destination)
                sources.append({"path": str(source.relative_to(base)), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    for file in ["aiken.toml", "aiken.lock"]:
        source = base / "reference/implementations/ctvs2/onchain" / file
        shutil.copy2(source, temp / file)
        sources.append({"path": str(source.relative_to(base)), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    binding = base / "reference/.build/ctvs2/lib/ctvs/deployment.ak"
    shutil.copy2(binding, temp / "lib/ctvs/deployment.ak")
    sources.append({"path": str(binding.relative_to(base)), "sha256": hashlib.sha256(binding.read_bytes()).hexdigest()})
    cache = base / "reference/.build/dependency-cache/packages"
    if not cache.exists():
        cache = base / "reference/.build/ctvs2/build/packages"
    shutil.copytree(cache, temp / "build/packages")
    shutil.copy2(probe / "wire-onchain.ak", temp / "validators/wire_review.ak")
    version = subprocess.run([compiler, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    command = [compiler, "check", "--deny", "--match-tests", "wire_review", "--seed", "20260918", str(temp)]
    result = subprocess.run(command, capture_output=True, text=True)
    (probe / "wire-onchain-results.json").write_text(result.stdout)
    (probe / "wire-onchain.stderr").write_text(result.stderr)
    (probe / "wire-onchain-source-bindings.json").write_text(json.dumps({"scope": "copied-source isolated compiled handler probes; not signed ledger transactions", "compiler": version, "probe_sha256": hashlib.sha256((probe / "wire-onchain.ak").read_bytes()).hexdigest(), "sources": sources}, indent=2) + "\n")
    print(result.stderr[-1200:])
    if result.returncode:
        print(result.stdout[-2400:])
        raise SystemExit(result.returncode)
    print(json.dumps(json.loads(result.stdout)["summary"]))
