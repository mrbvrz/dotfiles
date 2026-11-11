#!/usr/bin/env python3
"""
Agent Template Manager for Herdr
CRUD operations for ~/.config/herdr-core/templates/*.md
"""

import sys
import os
import glob
import json

TEMPLATES_DIR = os.path.expanduser("~/.config/herdr-core/templates")

def list_templates():
    templates = []
    os.makedirs(TEMPLATES_DIR, exist_ok=True)
    for path in sorted(glob.glob(os.path.join(TEMPLATES_DIR, "*.md"))):
        filename = os.path.basename(path)
        id_name = os.path.splitext(filename)[0]
        try:
            with open(path, "r", encoding="utf-8") as f:
                content = f.read()
        except Exception:
            continue

        name = id_name.capitalize()
        description = ""
        command = "agy"
        prompt = ""

        if content.startswith("---"):
            parts = content.split("---", 2)
            if len(parts) >= 3:
                fm_lines = parts[1].strip().split("\n")
                prompt = parts[2].strip()
                for line in fm_lines:
                    if ":" in line:
                        k, v = line.split(":", 1)
                        k = k.strip().lower()
                        v = v.strip()
                        if k == "name":
                            name = v
                        elif k == "description":
                            description = v
                        elif k == "command":
                            command = v
            else:
                prompt = content.strip()
        else:
            prompt = content.strip()

        templates.append({
            "name": id_name,
            "displayName": name,
            "description": description,
            "command": command,
            "prompt": prompt,
            "path": path
        })
    print(json.dumps(templates))

def save_template():
    if len(sys.argv) < 7:
        print(json.dumps({"error": "Missing arguments"}))
        sys.exit(1)
    
    id_name = sys.argv[2].strip().lower().replace(" ", "-")
    name = sys.argv[3].strip()
    command = sys.argv[4].strip()
    description = sys.argv[5].strip()
    prompt = sys.argv[6].strip()

    os.makedirs(TEMPLATES_DIR, exist_ok=True)
    path = os.path.join(TEMPLATES_DIR, f"{id_name}.md")

    content = f"""---
name: {name}
description: {description}
command: {command}
---
{prompt}
"""

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    
    print(json.dumps({"ok": True, "path": path, "id": id_name}))

def delete_template():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Missing template id"}))
        sys.exit(1)

    id_name = sys.argv[2].strip().lower()
    path = os.path.join(TEMPLATES_DIR, f"{id_name}.md")
    if os.path.exists(path):
        os.remove(path)
        print(json.dumps({"ok": True, "removed": path}))
    else:
        print(json.dumps({"ok": False, "error": "Not found"}))

if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "list"
    if action == "list":
        list_templates()
    elif action == "save":
        save_template()
    elif action == "delete":
        delete_template()
    else:
        print(json.dumps({"error": f"Unknown action {action}"}))
