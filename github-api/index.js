import express from "express";
import dotenv from "dotenv";
import cors from "cors"; // Recomendado para evitar problemas de conexión desde el frontend
import githubRoutes from "./analyze/github.routes.js";

// 1. Configurar variables de entorno
dotenv.config();

// 2. Inicializar la aplicación Express
const app = express();
const PORT = process.env.PORT || 3000;

// 3. Middlewares
app.use(cors()); // Permite peticiones desde otros dominios
app.use(express.json()); // Vital: Permite leer el body en formato JSON (req.body)

// 4. Rutas
// Montamos las rutas importadas bajo el prefijo '/api'
// Ejemplo: POST http://localhost:3000/api/list
app.use("/github", githubRoutes);

// Ruta base de prueba para verificar que el servidor corre
app.get("/", (req, res) => {
  res.send("🚀 Servidor de GitHub Commit Mesh funcionando correctamente.");
});

// 5. Iniciar el servidor
app.listen(PORT, () => {
  console.log(`\nServidor corriendo en: http://localhost:${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || "desarrollo"}`);
});
