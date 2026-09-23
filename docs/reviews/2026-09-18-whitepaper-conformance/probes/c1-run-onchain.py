from pathlib import Path
import json, shutil, subprocess, tempfile
base = Path(__file__).resolve().parents[4]
probe = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='ctvs-c1-review-') as name:
    temp = Path(name)
    for group in ['lib', 'validators']:
        shutil.copytree(base / 'reference/packages/onchain' / group, temp / group)
        shutil.copytree(base / 'reference/implementations/ctvs1/onchain' / group, temp / group, dirs_exist_ok=True)
    for file in ['aiken.toml', 'aiken.lock']:
        shutil.copy2(base / 'reference/implementations/ctvs1/onchain' / file, temp / file)
    shutil.copy2(base / 'reference/.build/ctvs1/lib/ctvs/deployment.ak', temp / 'lib/ctvs/deployment.ak')
    shutil.copytree(base / 'reference/.build/dependency-cache/packages', temp / 'build/packages')
    (temp / 'lib/review').mkdir()
    shutil.copy2(probe / 'c1-onchain.ak', temp / 'lib/review/c1_probe.ak')
    result = subprocess.run(['/tmp/ctvs-reference/aiken-aarch64-apple-darwin/aiken','check','--match-tests','review/c1_probe','--seed','20260918','--deny',str(temp)], capture_output=True, text=True)
    (probe / 'c1-onchain.result.json').write_text(result.stdout)
    (probe / 'c1-onchain.stderr.log').write_text(result.stderr)
    print(result.stderr[-1800:])
    if result.returncode:
        print(result.stdout[-2400:])
        raise SystemExit(result.returncode)
    report = json.loads(result.stdout)
    print(json.dumps(report['summary']))
