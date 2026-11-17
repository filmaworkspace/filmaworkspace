# Pruebas de las reglas de Firestore

Comprueban con el emulador de Firestore que `firestore.rules` deja hacer lo que
la app necesita y bloquea los accesos indebidos (hacerse admin, colarse en un
proyecto, listar formularios o códigos públicos, etc.).

Requisitos: Node y Java.

```bash
cd tests/firestore-rules
npm install --legacy-peer-deps
npm test
```

Ejecútalas antes de publicar cualquier cambio en las reglas.
