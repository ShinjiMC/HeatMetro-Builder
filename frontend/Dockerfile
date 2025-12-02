# frontend/Dockerfile

# --- ETAPA 1: Construcción (Build) ---
FROM node:20-alpine as build

WORKDIR /app

COPY package*.json ./
# Instalamos dependencias
RUN npm install

COPY . .

# Ejecutamos el build de React
# Esto creará una carpeta /app/build (o /app/dist si usas Vite)
RUN npm run build


# --- ETAPA 2: Servidor Nginx ---
FROM nginx:alpine

# 1. Copiamos los archivos estáticos generados en la etapa anterior
# IMPORTANTE: Si usas Vite, cambia '/app/build' por '/app/dist'
COPY --from=build /app/build /usr/share/nginx/html

# 2. Copiamos TU configuración de Nginx (la que creamos con los proxy_pass)
# Asegúrate de que el archivo nginx.conf esté en la misma carpeta que este Dockerfile
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]