#!/usr/bin/env python3
"""
MLX Validation Script — Apple Silicon LLM Validation
=====================================================
Called by validation-utils.ts to verify MLX setup and run inference checks.

Usage:
    python3 scripts/ai/validate.py                    # Full validation
    python3 scripts/ai/validate.py --check-only       # Only check availability
    python3 scripts/ai/validate.py --prompt "text"    # Custom prompt validation
    python3 scripts/ai/validate.py --json             # JSON output for programmatic use

Exit codes:
    0 = OK
    1 = MLX not available / validation failed
    2 = Model loading failed
    3 = Inference failed
"""

import sys
import json
import time
import argparse
import platform

DEFAULT_MODEL = "mlx-community/Qwen2.5-Coder-7B-Instruct-4bit"


def check_system():
    """Check if system supports MLX."""
    arch = platform.machine()
    system = platform.system()
    return {
        "apple_silicon": arch == "arm64" and system == "Darwin",
        "arch": arch,
        "system": system,
        "python_version": platform.python_version(),
    }


def check_mlx_available():
    """Check if MLX packages are importable."""
    result = {"mlx": False, "mlx_lm": False, "mlx_version": None}
    try:
        import mlx
        result["mlx"] = True
        result["mlx_version"] = mlx.__version__
    except ImportError:
        pass

    try:
        import mlx_lm  # noqa: F401
        result["mlx_lm"] = True
    except ImportError:
        pass

    return result


def validate_model(model_name, max_tokens=50):
    """Load model and run a test inference."""
    from mlx_lm import load, generate

    t0 = time.time()
    model, tokenizer = load(model_name)
    load_time = time.time() - t0

    t1 = time.time()
    prompt = "Write a one-line Python function that adds two numbers."
    response = generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens)
    inference_time = time.time() - t1

    return {
        "model": model_name,
        "load_time_s": round(load_time, 2),
        "inference_time_s": round(inference_time, 2),
        "response_length": len(response),
        "response_preview": response[:200],
        "vocab_size": tokenizer.vocab_size,
    }


def validate_custom_prompt(model_name, prompt, max_tokens=200):
    """Run custom prompt validation."""
    from mlx_lm import load, generate

    model, tokenizer = load(model_name)
    response = generate(model, tokenizer, prompt=prompt, max_tokens=max_tokens)

    return {
        "model": model_name,
        "prompt": prompt[:100],
        "response": response,
        "response_length": len(response),
    }


def main():
    parser = argparse.ArgumentParser(description="MLX Validation for Apple Silicon")
    parser.add_argument("--check-only", action="store_true", help="Only check availability")
    parser.add_argument("--json", action="store_true", help="JSON output")
    parser.add_argument("--prompt", type=str, help="Custom prompt to validate")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="Model name")
    parser.add_argument("--max-tokens", type=int, default=50, help="Max tokens for test")
    args = parser.parse_args()

    output = {"status": "ok", "checks": {}}

    # System check
    sys_info = check_system()
    output["checks"]["system"] = sys_info

    if not sys_info["apple_silicon"]:
        output["status"] = "error"
        output["error"] = f"Not Apple Silicon: {sys_info['arch']} on {sys_info['system']}"
        if args.json:
            print(json.dumps(output, indent=2))
        else:
            print(f"ERROR: {output['error']}")
        sys.exit(1)

    # MLX availability check
    mlx_info = check_mlx_available()
    output["checks"]["mlx"] = mlx_info

    if not mlx_info["mlx"] or not mlx_info["mlx_lm"]:
        output["status"] = "error"
        missing = []
        if not mlx_info["mlx"]:
            missing.append("mlx")
        if not mlx_info["mlx_lm"]:
            missing.append("mlx_lm")
        output["error"] = f"Missing packages: {', '.join(missing)}"
        if args.json:
            print(json.dumps(output, indent=2))
        else:
            print(f"ERROR: {output['error']}")
        sys.exit(1)

    if args.check_only:
        output["checks"]["model"] = {"name": args.model, "status": "not_tested"}
        if args.json:
            print(json.dumps(output, indent=2))
        else:
            print(f"OK: MLX {mlx_info['mlx_version']} available on Apple Silicon")
        sys.exit(0)

    # Model validation
    try:
        if args.prompt:
            model_result = validate_custom_prompt(args.model, args.prompt, args.max_tokens)
        else:
            model_result = validate_model(args.model, args.max_tokens)
        output["checks"]["model"] = model_result
    except Exception as e:
        output["status"] = "error"
        output["error"] = f"Model validation failed: {str(e)}"
        if args.json:
            print(json.dumps(output, indent=2))
        else:
            print(f"ERROR: {output['error']}")
        sys.exit(2 if "load" in str(e).lower() else 3)

    # Success
    if args.json:
        print(json.dumps(output, indent=2))
    else:
        model_info = output["checks"]["model"]
        print(f"OK: MLX {mlx_info['mlx_version']} | Model: {args.model}")
        if "load_time_s" in model_info:
            print(f"    Load: {model_info['load_time_s']}s | Inference: {model_info['inference_time_s']}s")
            print(f"    Response: {model_info['response_preview'][:80]}...")


if __name__ == "__main__":
    main()
