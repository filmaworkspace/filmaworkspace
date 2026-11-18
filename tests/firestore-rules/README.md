# Pruebas de las reglas de Firestore

Comprueban con los emuladores de Firestore y Storage que `firestore.rules` y `storage.rules` deja hacer lo que
la app necesita y bloquea los accesos indebidos (hacerse admin, colarse en un
proyecto, listar formularios o códigos públicos, etc.).

Requisitos: Node y Java.

```bash
cd tests/firestore-rules
npm install --legacy-peer-deps
npm test
```

Ejecútalas antes de publicar cualquier cambio en las reglas.

Si la máquina usa un proxy (HTTP_PROXY), arranca los emuladores sin él: las reglas de Storage consultan Firestore y esa llamada interna fallaría.
