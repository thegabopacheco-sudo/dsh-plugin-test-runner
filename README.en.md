# dsh-plugin-test-runner — Test Runner

Ejecuta y resume tests de un proyecto local para DeepSeek Harness: detecta scripts (npm/pnpm/yarn/pytest), corre con timeout y reporta pass/fail con salida real.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `detect` | Detectar tests |
| `run` | Ejecutar tests |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-test-runner` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-test-runner
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_TEST_RUNNER_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\test-runner\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
