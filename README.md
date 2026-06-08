# Fiesta Back

Backend NestJS para Fiesta/RifaTicket.

## Desarrollo local

```bash
npm install
npm run start:dev
```

La API local queda en `http://localhost:3000`.

## Deploy en Render

Este repo ya esta preparado para Render:

- Build Command: `npm install --include=dev && npm run build`
- Start Command: `npm run start:prod`
- Health Check Path: `/health`
- Node: `>=20`

El backend escucha en `process.env.PORT` y en `0.0.0.0`, que es lo que Render necesita para exponer un Web Service.

### Opcion 1: desde el dashboard

1. Entrar a `https://dashboard.render.com/`.
2. Crear un nuevo Web Service desde el repo `fiesta-back`.
3. Runtime: Node.
4. Branch: `main`.
5. Build Command: `npm install --include=dev && npm run build`.
6. Start Command: `npm run start:prod`.
7. Health Check Path: `/health`.
8. Crear una base Render Postgres en la misma region.
9. En Environment, cargar `DATABASE_URL` usando la Internal Database URL de Render Postgres.

Variables minimas para arrancar:

```bash
NODE_ENV=production
DATABASE_URL=<internal-database-url-de-render-postgres>
JWT_SECRET=<una-clave-larga-y-secreta>
TYPEORM_SYNCHRONIZE=true
```

Despues de que Render te de la URL del backend, configurar tambien:

```bash
BACKEND_URL=https://tu-back.onrender.com
API_BASE_URL=https://tu-back.onrender.com
FRONTEND_URL=https://tu-front.com
CORS_ORIGIN=https://tu-front.com
```

### Opcion 2: Blueprint

Tambien hay un `render.yaml` en el repo. Desde Render podes crear un Blueprint, pero igual vas a tener que cargar manualmente `DATABASE_URL`, `FRONTEND_URL`, `CORS_ORIGIN`, `BACKEND_URL` y `API_BASE_URL` porque dependen de tus servicios reales.

## Notas

- `TYPEORM_SYNCHRONIZE=true` mantiene el comportamiento actual y permite crear tablas en el primer deploy. Cuando el proyecto pase a produccion estable, conviene migrar a migraciones y cambiarlo a `false`.
- Los archivos subidos a `/uploads` se guardan en el disco del servicio. En Render Free no conviene depender de ese almacenamiento para archivos permanentes; para produccion conviene mover esos assets a S3, Cloudinary u otro storage persistente.
