# github-api/Dockerfile

# Usamos Alpine porque es muy ligero y este servicio no compila nada complejo
FROM node:20-alpine

# 1. INSTALACIÓN DE GIT
# Vital: simple-git necesita el ejecutable 'git' en el sistema
RUN apk add --no-cache git

WORKDIR /app

# 2. Instalar dependencias de Node
COPY package*.json ./
RUN npm install

# 3. Copiar el código fuente
COPY . .

# 4. Crear carpeta para clones y dar permisos
# Esto asegura que exista el destino donde se montará el volumen compartido
RUN mkdir -p /app/clones && chmod 777 /app/clones

# 5. Configurar variable de entorno para que tu código sepa dónde clonar
# IMPORTANTE: Asegúrate de modificar tu github.service.js para usar process.env.CLONES_DIR
ENV CLONES_DIR=/app/clones

EXPOSE 3000

CMD ["node", "index.js"]