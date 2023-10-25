# Fast Lora Trainer

- Streamlined image captioning processing.
- Auto setup images data folders.
- Auto sampling preview on dashboard.

# Setup

### Intall fast lora deps

if you dont have bun -> https://bun.sh/docs/installation#installing

```bash
bun install
```

### Setup kohya_ss
Full setup and pre Pre-requirements https://github.com/bmaltais/kohya_ss

Windows
```
cd kohya_ss
chmod +x ./setup.sh
./setup.bat
```

Linux or macOS
```
cd kohya_ss
chmod +x ./setup.sh
./setup.sh
```

To run:

You need to declare your checkpoint folder path with commandline argument '--ckpt-dir'.

```bash
bun start --ckpt-dir "<your folder path>"
```

# Development

For development without backend / generations

```bash
bun dev-dry
```
