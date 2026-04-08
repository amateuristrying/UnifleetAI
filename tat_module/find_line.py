import sys

pos_to_find = int(sys.argv[1])
file_path = sys.argv[2]

with open(file_path, 'r') as f:
    content = f.read()

line_num = content.count('\n', 0, pos_to_find) + 1
print(f"Position {pos_to_find} is at line {line_num}")

# Print context
start = max(0, pos_to_find - 20)
end = min(len(content), pos_to_find + 20)
print(f"Context: {content[start:end]!r}")
