import re

with open(r'C:\Users\Кирилл\.gemini\antigravity\scratch\taplink_auto_ae\taplink_ru_1_unzipped\s\js\app.js', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

print(f"File size: {len(content)} chars")

# Find API endpoints
pattern = r'\$api\.(?:post|get|put|patch|delete)\(["\']([^"\']+)["\']'
matches = re.findall(pattern, content)
unique = sorted(set(matches))
print('\n=== API ENDPOINTS ===')
for u in unique:
    print(u)

# Find animation types
anim_pattern = r'animations\s*[:=]\s*\{([^}]{0,500})\}'
anim_matches = re.findall(anim_pattern, content)
print('\n=== ANIMATION DEFS ===')
for m in anim_matches[:5]:
    print(m[:300])
    print('---')

# Find block-related patterns
print('\n=== BLOCK TYPE CONTEXTS ===')
idx = 0
found = 0
while found < 10:
    idx = content.find('block_type_id', idx+1)
    if idx == -1:
        break
    snippet = content[max(0,idx-100):idx+200]
    if any(c.isdigit() for c in snippet[100:130]):
        print(snippet)
        print('---')
        found += 1

# Search for "background" block type handling
print('\n=== BACKGROUND/BANNER HANDLING ===')
for keyword in ['background_image', 'banner', 'cover', 'upload']:
    positions = [m.start() for m in re.finditer(keyword, content, re.IGNORECASE)][:3]
    for pos in positions:
        print(f"[{keyword} @ {pos}]:", content[max(0,pos-80):pos+150])
        print('---')
