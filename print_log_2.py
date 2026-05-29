import json

transcript_path = r'C:\Users\cilli\.gemini\antigravity\brain\5e0cf2f5-918f-4e65-b51a-9957b6191bf1\.system_generated\logs\transcript.jsonl'

with open(transcript_path, 'r', encoding='utf-8') as f:
    steps = [json.loads(line) for line in f]

# Find model responses that contain MIDI, WebXR, and Timeline
found = False
for i, step in enumerate(steps):
    if step.get('source') == 'MODEL' and step.get('content'):
        content = step.get('content')
        if 'midi' in content.lower() and 'webxr' in content.lower() and 'timeline' in content.lower():
            print(f"Found match at step {i}!")
            with open(r'C:\Users\cilli\.gemini\antigravity\scratch\log_output.txt', 'w', encoding='utf-8') as out_f:
                out_f.write(content)
            print("Wrote to log_output.txt")
            found = True
            break

if not found:
    print("No matching step found with MIDI, WebXR, and Timeline.")
