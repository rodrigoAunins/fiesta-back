# Fiesta Back

Backend NestJS para Fiesta/RifaTicket.

## Desarrollo local

```bash
npm install
npm run start:dev
```

La API local queda en `http://localhost:3000`.

## Deploy en Railway

Este repo ya incluye `railway.json` para que Railway use:

- Build: `npm run build`
- Start: `npm run start:prod`
- Healthcheck: `/health`

Pasos sugeridos:

1. Crear un nuevo proyecto en Railway desde el repo `fiesta-back`.
2. Agregar un servicio de Postgres en el mismo proyecto.
3. En el servicio del backend, cargar las variables de `.env.example`.
4. Usar `DATABASE_URL` del Postgres de Railway como variable principal de base de datos.
5. Configurar `FRONTEND_URL`, `CORS_ORIGIN`, `BACKEND_URL` y `API_BASE_URL` con las URLs reales cuando estén disponibles.

Variables minimas para arrancar:

```bash
NODE_ENV=production
DATABASE_URL=${{Postgres.DATABASE_URL}}
JWT_SECRET=una_clave_larga_y_secreta
TYPEORM_SYNCHRONIZE=true
```

Railway define `PORT` automaticamente; no hace falta cargarlo.

## Notas

- `TYPEORM_SYNCHRONIZE=true` mantiene el comportamiento actual y permite crear tablas en el primer deploy. Cuando el proyecto pase a producción estable, conviene migrar a migraciones y cambiarlo a `false`.
- Los archivos subidos a `/uploads` se guardan en el disco del contenedor. En Railway pueden perderse entre deploys o reinicios; para producción conviene mover esos assets a S3, Cloudinary u otro storage persistente.
