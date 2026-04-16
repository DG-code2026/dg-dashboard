# Primary Dashboard — Tipo de Cambio en Tiempo Real

Dashboard que muestra bid/offer de AL30, AL30D y AL30C en tiempo real conectándose a la API de Primary (MATBA ROFEX) via WebSocket.

## Arquitectura

```
┌─────────────┐    WS    ┌──────────────┐    WS    ┌──────────────┐
│   Browser    │◄────────►│  Express +   │◄────────►│  Primary API │
│  Vite/React  │  :3001   │  WS Server   │  wss://  │  (MATBA ROFEX)│
└─────────────┘           └──────────────┘          └──────────────┘
```

- **Backend (Express + ws)**: Se autentica con Primary API, abre un WebSocket, se suscribe a Market Data de los 3 tickers y reenvía las actualizaciones a los clientes del frontend.
- **Frontend (Vite + React)**: Se conecta al backend por WebSocket y renderiza bid/offer en tarjetas con efecto flash al cambiar los precios.

## Setup

### 1. Cloná o copiá el proyecto

### 2. Configurá las credenciales

Editá el archivo `.env` en la raíz:

```env
PRIMARY_USER=tu_usuario
PRIMARY_PASS=tu_password
PRIMARY_REST_URL=https://api.primary.com.ar
PRIMARY_WS_URL=wss://api.primary.com.ar
PORT=3001
```

> **Nota**: Verificá que la URL de producción sea correcta para tu broker/acceso. Algunos brokers usan endpoints propios (ej: `api.veta.xoms.com.ar`).

### 3. Instalá dependencias

```bash
npm run install:all
```

### 4. Iniciá el proyecto

```bash
npm run dev
```

Esto levanta:
- Backend en `http://localhost:3001`
- Frontend en `http://localhost:5173`

## Endpoints

- `GET /api/health` — Estado del servidor y conexiones

## Tech Stack

- **Frontend**: Vite 5, React 18
- **Backend**: Express, ws (WebSocket)
- **Diseño**: Negro + Verde neón, Roboto / Roboto Mono
