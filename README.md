# PURO HUMO — versión definitiva

Aplicación web para administrar grupos, puntos, retos, solicitudes, subastas e historial del evento Haven. Interfaz en React + Vite; autenticación, persistencia y controles de acceso en Supabase.

## Secciones

- Inicio
- Retos
- Subastas
- Historial
- Administración (solo staff)

La plataforma contiene exclusivamente las cinco secciones definidas para el evento.

## Requisitos

- Node.js 20 o superior
- Proyecto Supabase
- Proyecto Vercel conectado al repositorio GitHub

## Configuración de Supabase

1. En Supabase, abre **SQL Editor**.
2. Ejecuta completo `supabase/migrations/001_initial_schema.sql`.
3. Crea la cuenta del organizador desde la aplicación.
4. En **Authentication → Users**, copia el UUID de esa cuenta.
5. En SQL Editor, promueve únicamente esa cuenta a administradora:

```sql
update public.profiles
set role = 'admin'
where user_id = 'UUID-DE-LA-CUENTA-DEL-ORGANIZADOR';
```

6. En **Authentication → Providers → Email**, decide si exigirás confirmación de correo. Si la activas, los usuarios deberán confirmar su correo antes de iniciar sesión y unirse al grupo.
7. En **Project Settings → API**, copia Project URL y Publishable key (o la clave anon heredada). Nunca uses `service_role` en el navegador.

## Variables de entorno

Copia `.env.example` como `.env` para desarrollo local y completa:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

En Vercel, añade esas mismas dos variables en **Settings → Environment Variables** y vuelve a desplegar.

## Uso

```bash
npm install
npm run dev
```

Para producción:

```bash
npm run build
```

Vercel detecta Vite automáticamente. Build command: `npm run build`; output directory: `dist`.

## Seguridad implementada

- RLS activado en todas las tablas operativas.
- Los participantes solo leen su propio grupo, sus movimientos y las solicitudes de ese grupo.
- El rol se asigna en el servidor y no puede modificarse desde el cliente.
- Los saldos no tienen escritura directa desde el navegador.
- Ajustes de puntos, aprobación de retos, ofertas y cierre de subastas se procesan mediante funciones SQL transaccionales.
- Las ofertas reservan puntos; si otro grupo supera la oferta, se devuelve la reserva anterior dentro de la misma transacción.
- Los códigos de invitación se almacenan como hashes SHA-256.

## Antes de abrir el evento

Realiza una prueba controlada con cuentas de staff y de dos grupos distintos. Verifica que un grupo no pueda consultar el saldo, historial o solicitudes de otro; que un miembro no pueda ejecutar funciones administrativas; y que una oferta simultánea no permita gastar el mismo saldo dos veces. Revisa además las reglas de confirmación de correo, recuperación de contraseña y privacidad de datos de participantes menores de edad.

La clave `service_role` nunca debe añadirse a variables `VITE_*`, al repositorio ni al código del navegador.
