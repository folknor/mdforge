---
code_block_style: monokai
footer: Page {page}
---

# Code Highlighting

This example demonstrates syntax highlighting with the Monokai theme.

## Highlight Themes

Change the theme with `code_block_style`:

```yaml
code_block_style: monokai
```

Available themes include: `github`, `monokai`, `vs`, `atom-one-dark`, `dracula`, and [many more](https://highlightjs.org/examples).

## JavaScript

```javascript
async function fetchData(url) {
  const response = await fetch(url);
  const data = await response.json();
  return data;
}

const users = await fetchData('/api/users');
console.log(users);
```

## Python

```python
from dataclasses import dataclass
from typing import List

@dataclass
class User:
    name: str
    email: str
    active: bool = True

def get_active_users(users: List[User]) -> List[User]:
    return [u for u in users if u.active]
```

## TypeScript

```typescript
interface Config {
  theme: string;
  format: 'A4' | 'Letter';
  margin: number;
}

function createPdf(config: Config): Promise<Buffer> {
  return new Promise((resolve) => {
    // Generate PDF...
  });
}
```

## Bash

```bash
#!/bin/bash

for file in *.md; do
  mdforge "$file"
  echo "Converted: $file"
done
```

## SQL

```sql
SELECT users.name, COUNT(orders.id) as order_count
FROM users
LEFT JOIN orders ON users.id = orders.user_id
WHERE users.active = true
GROUP BY users.id
HAVING order_count > 5
ORDER BY order_count DESC;
```
