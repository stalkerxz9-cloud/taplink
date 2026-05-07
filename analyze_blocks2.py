import re, json

with open(r'C:\Users\Кирилл\.gemini\antigravity\scratch\taplink_auto_ae\taplink_ru_1_unzipped\s\js\app.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

# Find vue component definitions for blocks
print("=== VUE BLOCK COMPONENTS ===")
for m in re.finditer(r'defineComponent\(["\']pages["\'],\s*["\']([^"\']+)["\']', content):
    print(m.group(1))

print("\n=== BLINK ANIMATION FULL CONTEXT ===")
for m in re.finditer(r'"blink"', content):
    idx = m.start()
    print(content[max(0,idx-500):idx+800])
    print("=====")

print("\n=== PAGES/BLOCKS API CALL STRUCTURE ===")
idx = content.find('"pages/blocks/set"')
if idx >= 0:
    print(content[max(0,idx-200):idx+1000])

print("\n=== LINK BLOCK VALUES ===")
# Find vue-pages-blocks-link or similar
for name in ['vue-pages-blocks-link', 'vue-pages-blocks-text', 'vue-pages-blocks-gallery', 'vue-pages-blocks-messenger']:
    idx = content.find(name)
    if idx >= 0:
        print(f"\n[{name}]")
        print(content[idx:idx+1500])
        print("---")

print("\n=== DEFAULT VALUES FOR LINKS ===")
for m in re.finditer(r'animation.*?blink|blink.*?animation', content, re.IGNORECASE):
    idx = m.start()
    print(content[max(0,idx-400):idx+600])
    print("---")
    break
