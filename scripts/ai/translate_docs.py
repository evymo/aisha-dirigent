import os
import json
import urllib.request
import urllib.parse
from pathlib import Path
from typing import List

# Základní nastavení převzato z existujícího principu ve web projektu
DEEPL_URL = "https://api-free.deepl.com/v2/translate"
TARGET_LANG = "EN-GB"  # Angličtina

def translate_markdown_deepl(text: str, auth_key: str) -> str:
    """Přeloží text pomocí DeepL API (převzatý princip z translate-missing.mjs)."""
    
    if not text.strip():
        return text
        
    data = urllib.parse.urlencode({
        "text": text,
        "source_lang": "CS",
        "target_lang": TARGET_LANG,
        "preserve_formatting": "1"
    }).encode("utf-8")
    
    headers = {
        "Authorization": f"DeepL-Auth-Key {auth_key}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
    
    req = urllib.request.Request(DEEPL_URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            res_json = json.loads(res_body)
            # DeepL api vrací pole translations
            return res_json["translations"][0]["text"]
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        raise RuntimeError(f"DeepL API chyba {e.code}: {body}")
    except Exception as e:
        raise RuntimeError(f"Chyba při komunikaci s DeepL: {str(e)}")

def main():
    # Načtení klíče z environmentu stejným způsobem jako v translate-missing.mjs
    auth_key = os.environ.get("DEEPL_AUTH_KEY") or os.environ.get("DEEPL_API_KEY")
    if not auth_key:
        print("❌ Chybí DeepL API klíč. Zkuste: export DEEPL_API_KEY=...")
        return
        
    repo_root = Path(__file__).parent.parent.parent
    target_dirs = [
        repo_root / "docs",
        repo_root / ".agents"
    ]
    
    files_to_translate: List[Path] = []
    for d in target_dirs:
        if d.exists():
            files_to_translate.extend(d.rglob("*.md"))
    
    if not files_to_translate:
        print("Nebyly nalezeny žádné .md soubory k překladu.")
        return

    print(f"Nalezeno {len(files_to_translate)} souborů k překladu.")
    print(f"Používám DeepL API princip (target: {TARGET_LANG}).\n")
    
    for filepath in files_to_translate:
        rel_path = filepath.relative_to(repo_root)
        
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
                
            if not content.strip():
                print(f"Translating: {rel_path}... Přeskočeno (prázdný).")
                continue
                
            print(f"Translating: {rel_path}... ", end="", flush=True)
            
            # Parametr tag_handling='html' by pomohl zachovat html tagy, pokud v MD jsou,
            # preserve_formatting="1" je bezpečnější minimum. Záleží na Deeplu, jak ošetří markdown,
            # v každém případě aplikujeme ověřený projektový vzor.
            translated_content = translate_markdown_deepl(content, auth_key)
            
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(translated_content)
                
            print("✓ OK")
        except Exception as e:
            print(f"✗ Chyba: {e}")

if __name__ == "__main__":
    main()
