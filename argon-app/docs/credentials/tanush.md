<!-- OWNER: tanush -->
# Encrypted team credential bundle

This authenticated AES-256-GCM bundle shares the supplied provider credentials without putting plaintext secrets in Git history. Scrypt derives the key (N=131072, r=8, p=1, 32 bytes). The unlock password is **separate**: Tanush supplies it once on each new computer. It is stored only as `CREDENTIAL_BUNDLE_PASSWORD` in the original ignored `.env`, never in Git. GitHub Actions secrets cannot be read back by another coding session and are not a cross-computer credential store.

From `argon-app/kernel`, run the command below in a terminal. It prompts without echo, authenticates/decrypts the bundle, and merges only its named entries into `argon-app/.env` with permissions 0600. It leaves fake mode and unrelated settings unchanged. The password prompt reads the terminal separately from the script input. No credentials go into command arguments, browser code or logs.

```sh
rtk proxy uv run --with cryptography python - <<'PY'
from pathlib import Path
import base64, getpass, json, os, tempfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt
root = Path.cwd().parent
text = (root / "docs/credentials/tanush.md").read_text()
bundle = json.loads(text.split("<!-- ENCRYPTED_BUNDLE -->\n", 1)[1].split("\n<!-- END_BUNDLE -->", 1)[0])
assert bundle["format"] == "foundry-credential-bundle-v1"
unlock = getpass.getpass("Team bundle unlock password: ")
dec = base64.b64decode
key = Scrypt(salt=dec(bundle["salt"]), length=32, n=131072, r=8, p=1).derive(unlock.encode())
entries = json.loads(AESGCM(key).decrypt(dec(bundle["nonce"]), dec(bundle["ciphertext"]), b"foundry-credential-bundle-v1"))
allowed = {"GEMINI_API_KEY", "COMPOSIO_API_KEY", "ELEVENLABS_API_KEY", "PRIVY_APP_ID", "PRIVY_APP_SECRET", "KERNEL_TOKEN", "GITHUB_SANDBOX_TOKEN", "ELEVENLABS_AGENT_ID"}
assert isinstance(entries, dict) and entries.keys() <= allowed
assert all(isinstance(v, str) and "\n" not in v and "\r" not in v for v in entries.values())
path = root / ".env"
lines = path.read_text().splitlines() if path.exists() else (root / ".env.example").read_text().splitlines()
seen = set()
out = []
for line in lines:
    name = line.split("=", 1)[0].strip()
    if name in entries:
        if name not in seen:
            out.append(name + "=" + entries[name])
            seen.add(name)
    else:
        out.append(line)
out.extend(k + "=" + v for k, v in entries.items() if k not in seen)
fd, temporary = tempfile.mkstemp(prefix=".env.restore-", dir=root)
try:
    with os.fdopen(fd, "w") as target:
        target.write("\n".join(out) + "\n")
    os.replace(temporary, path)
except BaseException:
    Path(temporary).unlink(missing_ok=True)
    raise
print("Provider credentials restored to ignored server environment (0600).")
PY
```

Ciphertext follows. Do not place its unlock password here. If a credential changes, regenerate this bundle with a fresh salt/nonce, distribute the password separately, and rerun provider checks. Access to this file plus its password grants access to all bundled provider credentials.

<!-- ENCRYPTED_BUNDLE -->
{
  "format": "foundry-credential-bundle-v1",
  "salt": "hViw1eOnyIBzs9wH3ikY4g==",
  "nonce": "zjsAI22+Ygdk16aW",
  "ciphertext": "e/DVHmRZT3cEK7p7nPqjKWDNdoNwNV6thgRdGmioUZ0mymsgNs/f5pOvxID0GC1DcqY1oXHUBUggJ3Nnf/8+je1nlN8ppJp5x8ktNkCI4woIpM7ywEWc+Id0od0SM/0gBp4lbAtWGz5aDdwsp49y0YJzdBnk0Dlm/gLxqfpExHdF12PPnfbFP5ESnohsjI4kbx1NFPz/P2GemJ+AYYAw2C6Y9vkh/yS3z/aoQ7c+3wrDtpZWnU5dKHl29MJ5xFHC03rnt0FNF7Wui1NuY+f3/xhqG+hD59dhBIxdilpmWAqC37cP9TRJHQ6y4YaRItzbVkhEQHVOvgC7bb02feZXSO+eL/4beaxR/MxuPdTFgG62o2xplj9lnmEdFXPrfbpyvBDDSnauQRk9IvEVoSlfoKvWsYKGawS+9XH8X34XYyTBJz3yVkL6uWtNu8gR3+7vs8sgYR0SeKhC1lYrq91cYOz3YYQ8dSilJfr4T2Uj71I8DDa/8pA="
}
<!-- END_BUNDLE -->
