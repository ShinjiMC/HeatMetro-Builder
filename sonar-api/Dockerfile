# Usamos Debian Bookworm porque es más compatible con los binarios que descarga 'g' que Alpine
FROM node:20-bookworm

# 1. Instalar dependencias del sistema
# - curl: Para descargar 'g'
# - git: Para que 'go install' pueda bajar repositorios
# - openjdk-17-jre: Para el SonarScanner
# - build-essential (python3, make, g++): Para compilar better-sqlite3
RUN apt-get update && apt-get install -y \
    curl \
    git \
    openjdk-17-jre \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# -----------------------------------------------------------------------------
# 2. INSTALAR LA HERRAMIENTA 'g' (voidint/g)
# -----------------------------------------------------------------------------
# Definimos la carpeta donde 'g' guardará las versiones de Go
ENV G_HOME="/root/.g"

# Descargamos el binario de 'g' y lo ponemos en /usr/local/bin para que sea accesible globalmente
# Usamos la versión 1.8.0 que confirmaste que usas
RUN curl -sL https://github.com/voidint/g/releases/download/v1.8.0/g1.8.0.linux-amd64.tar.gz \
    | tar -xz -C /usr/local/bin

# -----------------------------------------------------------------------------
# 3. CONFIGURAR VARIABLES DE ENTORNO PARA GO
# -----------------------------------------------------------------------------
# Esto es CRÍTICO: Agregamos al PATH la ruta donde 'g' pone el enlace simbólico a la versión activa.
# De esta forma, si ejecutas "go" sin configurar nada, usará la versión activa de g.
ENV PATH="${G_HOME}/go/bin:${PATH}"

# Configurar mirror para descargas más rápidas (opcional, usa el oficial de Google)
ENV G_MIRROR="https://go.dev/dl/"

# 4. PRE-INSTALAR UNA VERSIÓN DE GO
# Esto es vital para inicializar la estructura de carpetas de 'g' (/root/.g/...)
# Instalamos una versión reciente (ej. 1.22.1) para que el contenedor no esté "vacío" de Go.
# Tu script setup_go.js cambiará esto dinámicamente según el go.mod del proyecto a analizar.
RUN g install 1.22.1 && g use 1.22.1

# Verificamos que todo funciona
RUN g --version && go version

# -----------------------------------------------------------------------------
# 5. CONFIGURACIÓN DE NODE.JS (Tu aplicación)
# -----------------------------------------------------------------------------
COPY package*.json ./
RUN npm install 

COPY . .

# Crear carpetas necesarias y dar permisos
RUN mkdir -p uploads && chmod 777 uploads
RUN mkdir -p /app/clones && chmod 777 /app/clones
RUN mkdir -p /app/data && chmod 777 /app/data

# Variables de entorno por defecto
ENV CLONES_PATH=/app/clones

EXPOSE 3001

CMD ["node", "server.js"]