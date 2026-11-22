# Rumbo

Primer vertical del nuevo buscador y planeador de viajes. Convive con la página y el actualizador históricos del directorio superior.

Producción: https://rumbo-viajes-three.vercel.app

## Estado actual

- Next.js 16 + TypeScript, preparado para Vercel.
- Ranking de 78 destinos por costo total, presupuesto y clima.
- Comparación de vuelos, casas y clima durante los 12 meses.
- Filtros por región, pasajeros, noches, presupuesto y criterio.
- Calculadora de viaje en auto con rutas OSRM, combustible oficial y lugares cercanos.
- Formulario para destino, cualquier fecha, pasajeros y habitaciones.
- API server-side `POST /api/search/stays`.
- Contrato normalizado para Airbnb, Booking.com y Vrbo.
- Adaptador real de StayingAPI; no se usan endpoints privados de Airbnb.
- Supabase conectado con RLS, historial de búsquedas, auditoría de proveedores y ofertas con vencimiento.
- Clima, cambio y feriados consultados desde fuentes externas con caché.
- Sin una clave configurada, el buscador explica qué falta y no devuelve datos simulados.

## Configuración

1. Copiar `.env.example` a `.env.local`.
2. Crear una clave sandbox/gratuita en https://stayingapi.com/signup.
3. Completar `STAYINGAPI_KEY` sólo en el servidor.
4. Vincular Supabase y ejecutar `supabase db push` antes de habilitar persistencia.

Variables previstas:

- `STAYINGAPI_KEY`: secreto para búsquedas de estadías.
- `NEXT_PUBLIC_SUPABASE_URL`: URL pública del proyecto.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: clave publicable, protegida con RLS.
- `SUPABASE_SECRET_KEY`: sólo servidor; nunca se expone al navegador.

## Verificación local realizada

```bash
npm run typecheck
npm run lint
npm run build
```

El proyecto está vinculado a `demotuc/rumbo-viajes` y desplegado en producción. Supabase está activo en `sa-east-1`, las migraciones están aplicadas y las búsquedas de alojamientos se persisten desde el servidor.

## Próximos adaptadores

1. Vuelos: Duffel y luego Amadeus.
2. Peajes: HERE Routing.
3. Lugares enriquecidos: Geoapify/OpenTripMap.
4. Alertas y favoritos por usuario.
