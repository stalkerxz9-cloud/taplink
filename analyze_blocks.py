import re

with open(r'C:\Users\Кирилл\.gemini\antigravity\scratch\taplink_auto_ae\taplink_ru_1_unzipped\s\js\app.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# 1. Find all block names/titles in the interface
print("=== BLOCK TYPES IN CHOOSER ===")
# Look for vue-pages-blocks-form-choose or block chooser
choose_idx = content.find('vue-pages-blocks-form-choose')
if choose_idx >= 0:
    print(content[choose_idx:choose_idx+3000])
print("---END---\n")

# 2. Find the banner block structure
print("=== BANNER BLOCK STRUCTURE ===")
banner_idx = content.find('vue-pages-blocks-banner')
if banner_idx >= 0:
    print(content[banner_idx:banner_idx+2000])
print("---END---\n")

# 3. Find pages/blocks/set API call to understand data structure
print("=== PAGES/BLOCKS/SET STRUCTURE ===")
for m in re.finditer(r'pages/blocks/set', content):
    idx = m.start()
    print(content[max(0,idx-300):idx+500])
    print("---")

# 4. Find "link" block - button with animation
print("=== LINK BLOCK / ANIMATION ===")
for m in re.finditer(r'"blink"', content):
    idx = m.start()
    print(content[max(0,idx-300):idx+500])
    print("---")
    break  # just first occurrence

# 5. Find text-block / centeredtext
print("=== TEXT ALIGNMENT ===")
for keyword in ['text-align', 'align.*center', 'centered']:
    for m in re.finditer(keyword, content, re.IGNORECASE):
        idx = m.start()
        snippet = content[max(0,idx-100):idx+200]
        if 'values' in snippet or 'options' in snippet:
            print(f"[{keyword}]:", snippet)
            print("---")
            break
