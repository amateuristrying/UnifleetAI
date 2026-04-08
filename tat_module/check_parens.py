import sys

def check_sql_file(filename):
    with open(filename, 'r') as f:
        content = f.read()

    stack = []
    pairs = {'(': ')', '{': '}', '[': ']'}
    pos_stack = []

    in_string = False
    string_char = None
    in_comment = False
    comment_type = None

    i = 0
    while i < len(content):
        c = content[i]
        
        # Simple comment/string handling
        if not in_comment and not in_string:
            if c == '-' and i + 1 < len(content) and content[i+1] == '-':
                in_comment = True
                comment_type = '--'
                i += 2
                continue
            if c == '/' and i + 1 < len(content) and content[i+1] == '*':
                in_comment = True
                comment_type = '/*'
                i += 2
                continue
            if c in ["'", '"']:
                in_string = True
                string_char = c
                i += 1
                continue
            if c in pairs.keys():
                stack.append(c)
                pos_stack.append(i)
            elif c in pairs.values():
                if not stack:
                    print(f"Extra closing {c} at position {i}")
                else:
                    last = stack.pop()
                    pos = pos_stack.pop()
                    if pairs[last] != c:
                        print(f"Mismatch: {last} at {pos} closed by {c} at {i}")
        elif in_comment:
            if comment_type == '--' and c == '\n':
                in_comment = False
            elif comment_type == '/*' and c == '*' and i + 1 < len(content) and content[i+1] == '/':
                in_comment = False
                i += 1
        elif in_string:
            if c == string_char:
                # Handle escaped quotes ''
                if i + 1 < len(content) and content[i+1] == string_char:
                    i += 1
                else:
                    in_string = False

        i += 1

    for c, pos in zip(stack, pos_stack):
        print(f"Unclosed {c} at position {pos}")
        # Print a bit of context around the unclosed bracket
        start = max(0, pos - 20)
        end = min(len(content), pos + 20)
        print(f"Context: {content[start:end]!r}")

if __name__ == '__main__':
    check_sql_file(sys.argv[1])
