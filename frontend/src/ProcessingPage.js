import React, { useState, useEffect, useRef } from "react";
import { withRouter } from "react-router-dom";
import PropTypes from "prop-types";
import axios from "axios";
import Navbar from "./Nav";
import Loading from "./Loading";

// --- CONFIGURACIÓN DE APIS ---
const API_BASE_URL = "/api/gh"; //const API_BASE_URL = "http://localhost:3000";
const ANALYSIS_API_URL = "/api/sonar"; //const ANALYSIS_API_URL = "http://localhost:3001";

const ProcessingPage = ({ history, location }) => {
  // Datos recibidos del Home
  const { repo, branch, commits, selectionType } = location.state || {};
  const [repoPath, setRepoPath] = useState(null);

  // Estados de Clonado
  const [cloningStatus, setCloningStatus] = useState("idle");
  const [statusMessage, setStatusMessage] = useState("Iniciando...");

  // Estados de Configuración (Sonar)
  const [sonarContent, setSonarContent] = useState("");
  const [showSetupModal, setShowSetupModal] = useState(true);

  // Estados de Análisis
  const [commitsList, setCommitsList] = useState([]);
  const [analysisStatus, setAnalysisStatus] = useState({});
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [dbStatus, setDbStatus] = useState("idle");
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!repo || !commits) {
      history.push("/");
      return;
    }
    setCommitsList(commits);
    triggerClone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determina si hay ALGÚN proceso corriendo actualmente
  const isAnyRunning =
    isAnalyzingAll ||
    Object.values(analysisStatus).some((s) => s.status === "running");

  const isGlobalBusy = isAnyRunning || dbStatus !== "idle";

  const triggerClone = async () => {
    setCloningStatus("cloning");
    setStatusMessage(`Clonando repositorio ${repo}... Por favor espera.`);

    try {
      const response = await axios.post(`${API_BASE_URL}/github/clone`, {
        repoUrl: repo,
        commits: commits,
        branchOrTag: branch,
        type: selectionType,
      });

      if (response.data.path) {
        setRepoPath(response.data.path);
      }

      setCloningStatus("success");
      setStatusMessage("Repositorio clonado y listo para análisis.");
    } catch (err) {
      console.error("Error clonando:", err);
      setCloningStatus("error");
      setStatusMessage(
        `Error al clonar: ${err.response?.data?.message || err.message}`
      );
    }
  };

  const handleDownloadDb = async () => {
    if (isGlobalBusy) return;
    setDbStatus("downloading");
    try {
      const response = await fetch(`${ANALYSIS_API_URL}/download-db`);
      if (!response.ok) throw new Error("Error al descargar la BD");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "repositories.db";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      alert("Error descargando la base de datos.");
    } finally {
      setDbStatus("idle");
    }
  };

  const triggerImportDb = () => {
    if (isGlobalBusy) return;
    fileInputRef.current.click();
  };

  const handleImportFileChange = async (e) => {
    const inputElement = e.target;
    const file = inputElement.files[0];
    if (!file) return;

    if (
      !window.confirm("Importar una BD sobrescribirá la actual. ¿Estás seguro?")
    ) {
      inputElement.value = "";
      return;
    }
    setDbStatus("importing");
    const formData = new FormData();
    formData.append("databaseFile", file);
    try {
      const response = await axios.post(
        `${ANALYSIS_API_URL}/import-db`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data" },
        }
      );
      alert(response.data.message || "Base de datos importada exitosamente.");
    } catch (error) {
      console.error(error);
      alert(
        `Error importando: ${error.response?.data?.error || error.message}`
      );
    } finally {
      setDbStatus("idle");
      if (inputElement) {
        inputElement.value = "";
      }
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setSonarContent(ev.target.result);
    reader.readAsText(file);
  };

  // Función para cerrar el modal validando que haya datos
  const handleSaveConfig = () => {
    if (!sonarContent.trim()) {
      alert(
        "⚠️ El archivo sonar-project.properties es obligatorio para continuar."
      );
      return;
    }
    setShowSetupModal(false);
  };

  const handleAnalyzeClick = async (commit) => {
    if (dbStatus !== "idle") {
      alert("Espera a que termine la operación de base de datos.");
      return;
    }
    if (!repoPath) {
      alert(
        "Error: No se tiene la ruta del repositorio. Reintenta el clonado."
      );
      return;
    }

    setAnalysisStatus((prev) => ({
      ...prev,
      [commit.sha]: { status: "running", step: "Iniciando..." },
    }));

    const formData = new FormData();
    formData.append("repoPath", repoPath);
    formData.append("commitData", JSON.stringify(commit));

    // Crear un archivo Blob al vuelo con el contenido del textarea
    const sonarBlob = new Blob([sonarContent], { type: "text/plain" });
    formData.append("sonarProperties", sonarBlob, "sonar-project.properties");

    try {
      const response = await fetch(`${ANALYSIS_API_URL}/analyze`, {
        method: "POST",
        body: formData,
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n\n");
        lines.forEach((line) => {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.replace("data: ", ""));
              let newStatus = "running";
              if (data.status === "completed") newStatus = "completed";
              if (data.status === "skipped") newStatus = "skipped";
              if (data.status === "error") newStatus = "error";

              setAnalysisStatus((prev) => ({
                ...prev,
                [commit.sha]: {
                  status: newStatus,
                  step: data.step || data.message,
                  errorMsg: data.status === "error" ? data.message : null,
                },
              }));
            } catch (e) {
              console.error("Error parseando SSE:", e);
            }
          }
        });
      }
    } catch (error) {
      console.error("Error de conexión:", error);
      setAnalysisStatus((prev) => ({
        ...prev,
        [commit.sha]: {
          status: "error",
          step: "Error de red",
          errorMsg: "No se pudo conectar al servidor de análisis.",
        },
      }));
    }
  };

  const handleAnalyzeAll = async () => {
    if (dbStatus !== "idle") return;
    if (!repoPath || cloningStatus !== "success") return;

    setIsAnalyzingAll(true);
    const pendingCommits = commitsList.filter((commit) => {
      const status = analysisStatus[commit.sha]?.status;
      return status !== "completed" && status !== "skipped";
    });

    if (pendingCommits.length === 0) {
      alert("Todos los commits ya han sido analizados.");
      setIsAnalyzingAll(false);
      return;
    }

    for (const commit of pendingCommits) {
      try {
        await handleAnalyzeClick(commit);
      } catch (error) {
        console.error(`Error procesando lote en commit ${commit.sha}`, error);
      }
    }
    setIsAnalyzingAll(false);
    alert("Proceso de análisis masivo finalizado.");
  };

  const renderCommitAction = (commit) => {
    const state = analysisStatus[commit.sha];
    const status = state?.status;
    const stepText = state?.step || "Analizar";
    const isActionDisabled = cloningStatus !== "success" || isGlobalBusy;

    if (status === "completed") {
      return (
        <button
          className="btn-primary"
          style={{
            padding: "8px 16px",
            fontSize: "0.85rem",
            backgroundColor: "#2ecc71", // CORREGIDO: backgroundColor
            backgroundImage: "none",
            cursor: "default",
            width: "160px",
            opacity: 1,
            filter: "none",
            color: "white",
          }}
          disabled
        >
          Analizado
        </button>
      );
    }

    if (status === "skipped") {
      const reasonShort = "Sin Cambios";
      const reasonLong =
        state?.step ||
        "El análisis determinó que no es necesario procesar este commit.";
      return (
        <button
          title={reasonLong}
          style={{
            padding: "8px 16px",
            fontSize: "0.85rem",
            backgroundColor: "#95a5a6", // CORREGIDO: backgroundColor
            color: "white",
            border: "none",
            borderRadius: "12px",
            cursor: "help",
            width: "160px",
            opacity: 1,
            filter: "none",
          }}
          disabled
        >
          {reasonShort}
        </button>
      );
    }

    if (status === "running") {
      return (
        <button
          className="btn-primary"
          style={{
            padding: "8px 16px",
            fontSize: "0.85rem",
            backgroundColor: "#3e8bff", // CORREGIDO: backgroundColor
            backgroundImage: "none",
            cursor: "wait",
            width: "160px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "5px",
            opacity: 1,
            color: "white",
          }}
          disabled
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              border: "2px solid white",
              borderTopColor: "transparent",
              borderRadius: "50%",
              display: "inline-block",
              animation: "spin 1s linear infinite",
            }}
          ></span>
          <span
            style={{
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "120px",
            }}
          >
            {stepText}
          </span>
        </button>
      );
    }

    if (status === "error") {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "5px",
          }}
        >
          <button
            className="btn-primary"
            style={{
              padding: "8px 16px",
              fontSize: "0.85rem",
              backgroundColor: "#e74c3c", // CORREGIDO: backgroundColor
              backgroundImage: "none",
              width: "160px",
              opacity: 1,
            }}
            onClick={() => handleAnalyzeClick(commit)}
            disabled={isAnyRunning}
          >
            ↻ Reintentar
          </button>
          <span
            style={{
              color: "#e74c3c",
              fontSize: "0.75rem",
              maxWidth: "200px",
              textAlign: "right",
            }}
          >
            {state.errorMsg || "Falló"}
          </span>
        </div>
      );
    }

    return (
      <button
        className="btn-primary"
        style={{
          padding: "8px 16px",
          fontSize: "0.85rem",
          opacity: !isActionDisabled ? 1 : 0.5,
          cursor: !isActionDisabled ? "pointer" : "not-allowed",
          width: "160px",
        }}
        onClick={() => handleAnalyzeClick(commit)}
        disabled={isActionDisabled}
      >
        Analizar
      </button>
    );
  };

  return (
    <main
      style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}
    >
      <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      <Navbar />
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        accept=".db"
        onChange={handleImportFileChange}
      />
      {/* --- MODAL DE CONFIGURACIÓN (BLOQUEANTE) --- */}
      {showSetupModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            backdropFilter: "blur(8px)",
            zIndex: 9999,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "20px",
          }}
        >
          <div
            className="glass-card"
            style={{ maxWidth: "500px", animation: "fadeIn 0.3s ease" }}
          >
            <h2 className="section-title" style={{ fontSize: "1.5rem" }}>
              Configuración Requerida
            </h2>
            <p className="section-description">
              Para analizar el código, es obligatorio proporcionar el archivo{" "}
              <span
                style={{
                  fontFamily: "monospace",
                  background: "var(--input-bg)",
                  color: "var(--brand-orange)",
                  padding: "4px 8px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  fontWeight: "600",
                  fontSize: "0.9rem",
                }}
              >
                sonar-project.properties
              </span>
              .
            </p>

            <div className="field-group">
              <label className="label-text" htmlFor="file-upload">
                Opción A: Subir Archivo
              </label>
              <input
                id="file-upload"
                type="file"
                accept=".properties,.txt"
                onChange={handleFileUpload}
                className="input-modern"
                style={{ padding: "10px", marginBottom: "15px" }}
              />

              <label className="label-text" htmlFor="sonar-content">
                Opción B: Pegar Contenido
              </label>
              <textarea
                id="sonar-content"
                className="input-modern"
                rows={6}
                placeholder="sonar.projectKey=my_project..."
                value={sonarContent}
                onChange={(e) => setSonarContent(e.target.value)}
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.85rem",
                  resize: "vertical",
                }}
              />
            </div>

            <button
              className="btn-primary"
              onClick={handleSaveConfig}
              style={{ marginTop: "10px" }}
            >
              Guardar y Continuar
            </button>
            <p
              style={{
                fontSize: "0.8rem",
                color: "var(--text-secondary)",
                textAlign: "center",
                marginTop: "15px",
              }}
            >
              * El repositorio se está clonando en segundo plano mientras
              configuras.
            </p>
          </div>
        </div>
      )}

      <div
        className="container-custom"
        style={{
          flex: 1,
          padding: "40px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {/* --- SECCIÓN SUPERIOR: ESTADO --- */}
        <div
          className="glass-card"
          style={{
            padding: "20px",
            display: "flex",
            gap: "20px",
            alignItems: "flex-start",
            maxWidth: "100%",
          }}
        >
          {/* Columna Estado Clonado */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "20px",
            }}
          >
            {/* 1. Estado Clonado */}
            <div>
              <h3
                className="section-title"
                style={{
                  fontSize: "1.2rem",
                  textAlign: "left",
                  marginBottom: "10px",
                }}
              >
                Estado del Repositorio
              </h3>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "15px",
                  padding: "15px",
                  background:
                    cloningStatus === "error"
                      ? "rgba(239, 68, 68, 0.1)"
                      : "var(--input-bg)",
                  borderRadius: "12px",
                  border: `1px solid ${
                    cloningStatus === "success"
                      ? "#2ecc71"
                      : cloningStatus === "error"
                      ? "#e74c3c"
                      : "var(--border-color)"
                  }`,
                }}
              >
                {cloningStatus === "cloning" && <Loading dark={true} />}
                {cloningStatus === "success" && (
                  <span style={{ fontSize: "1.5rem" }}>✅</span>
                )}
                {cloningStatus === "error" && (
                  <span style={{ fontSize: "1.5rem" }}>❌</span>
                )}
                <div>
                  <strong
                    style={{ display: "block", color: "var(--text-primary)" }}
                  >
                    {cloningStatus === "cloning"
                      ? "Clonando archivos..."
                      : cloningStatus === "success"
                      ? "Clonado Completado"
                      : "Error"}
                  </strong>
                  <span
                    style={{
                      fontSize: "0.9rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {statusMessage}
                  </span>
                </div>
              </div>
            </div>

            {/* 2. Gestión de Base de Datos (Sin Iconos) */}
            <div>
              <h3
                className="section-title"
                style={{
                  fontSize: "1.2rem",
                  textAlign: "left",
                  marginBottom: "10px",
                }}
              >
                Gestión de Base de Datos
              </h3>
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="btn-ghost"
                  style={{
                    flex: 1,
                    display: "flex",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: isGlobalBusy ? "not-allowed" : "pointer",
                    opacity: isGlobalBusy ? 0.5 : 1,
                    padding: "10px", // Ajuste de padding al quitar iconos
                  }}
                  onClick={handleDownloadDb}
                  disabled={isGlobalBusy}
                >
                  {dbStatus === "downloading"
                    ? "Descargando..."
                    : "Descargar DB"}
                </button>

                <button
                  className="btn-ghost"
                  style={{
                    flex: 1,
                    display: "flex",
                    justifyContent: "center",
                    gap: "8px",
                    cursor: isGlobalBusy ? "not-allowed" : "pointer",
                    opacity: isGlobalBusy ? 0.5 : 1,
                    padding: "10px",
                  }}
                  onClick={triggerImportDb}
                  disabled={isGlobalBusy}
                >
                  {dbStatus === "importing" ? "Importando..." : "Importar DB"}
                </button>
              </div>
            </div>
          </div>

          {/* Columna Configuración Sonar (RESUMEN) */}
          <div style={{ flex: 1 }}>
            <h3
              className="section-title"
              style={{
                fontSize: "1.2rem",
                textAlign: "left",
                marginBottom: "10px",
              }}
            >
              Configuración Sonar
            </h3>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "15px",
                background: "var(--input-bg)",
                borderRadius: "12px",
                border: "1px solid var(--border-color)",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                {/* Icono SonarCloud */}
                <div
                  style={{
                    width: "40px",
                    height: "40px",
                    background: "var(--input-bg)",
                    borderRadius: "8px",
                    border: "1px solid var(--border-color)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: "15px",
                  }}
                >
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    role="img"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="var(--brand-orange)"
                  >
                    <title>SonarCloud icon</title>
                    <path d="M22.406 10.9a7.088 7.088 0 00-3.377-2.358v-.085c0-4.035-3.156-7.324-7.047-7.324-3.893 0-7.05 3.282-7.05 7.325v.1C2.081 9.492 0 12.268 0 15.542c0 4.035 3.159 7.325 7.05 7.325a6.907 6.907 0 004.952-2.108 6.885 6.885 0 004.947 2.108c3.884 0 7.051-3.282 7.051-7.325a7.572 7.572 0 00-1.594-4.643zM16.95 21.014c-2.903 0-5.267-2.456-5.267-5.474a.91.91 0 00-.89-.924.906.906 0 00-.892.925c0 1.368.367 2.651.994 3.748a5.156 5.156 0 01-3.845 1.733c-2.904 0-5.27-2.457-5.27-5.474 0-3.016 2.366-5.473 5.27-5.473.63 0 1.241.117 1.827.335.007 0 .013.007.02.007.203.071.489.21.578.287a.858.858 0 001.249-.1.942.942 0 00-.097-1.3c-.39-.342-.995-.575-1.144-.63a6.814 6.814 0 00-2.425-.443c-.113 0-.225 0-.338.007.12-2.916 2.433-5.247 5.27-5.247 2.903 0 5.267 2.456 5.267 5.474a5.569 5.569 0 01-2.215 4.463.948.948 0 00-.21 1.283c.171.25.45.39.727.39a.86.86 0 00.516-.172 7.381 7.381 0 002.709-4.02c2.035.785 3.449 2.829 3.449 5.139-.007 3.01-2.371 5.466-5.283 5.466z" />
                  </svg>
                </div>
                <div>
                  <strong
                    style={{ display: "block", color: "var(--text-primary)" }}
                  >
                    Properties Cargado
                  </strong>
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {sonarContent.length} caracteres
                  </span>
                </div>
              </div>
              <button
                className="btn-ghost"
                style={{
                  width: "auto",
                  padding: "8px 12px",
                  fontSize: "0.85rem",
                }}
                onClick={() => setShowSetupModal(true)}
              >
                Editar / Ver
              </button>
            </div>

            {/* ZONA DE ANÁLISIS TOTAL */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: "5px",
                marginTop: "20px",
              }}
            >
              <div style={{ textAlign: "right" }}>
                <span
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    color: "var(--text-secondary)",
                    fontWeight: 600,
                  }}
                >
                  {commitsList.length} commits listados
                </span>
                {/* Contador de procesados */}
                <span
                  style={{
                    display: "block",
                    fontSize: "0.8rem",
                    color: "var(--brand-orange)",
                    fontWeight: 500,
                  }}
                >
                  {
                    commitsList.filter((c) =>
                      ["completed", "skipped", "error"].includes(
                        analysisStatus[c.sha]?.status
                      )
                    ).length
                  }
                  /{commitsList.length} procesados
                </span>
              </div>

              <button
                className="btn-primary"
                style={{
                  background: isAnalyzingAll
                    ? "var(--text-secondary)"
                    : "var(--brand-blue)",
                  cursor:
                    cloningStatus !== "success" || isGlobalBusy
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    cloningStatus !== "success" || isGlobalBusy ? 0.7 : 1,
                  minWidth: "140px",
                  marginTop: "5px",
                }}
                onClick={handleAnalyzeAll}
                disabled={cloningStatus !== "success" || isAnyRunning}
              >
                {isAnalyzingAll ? "Procesando..." : "Analizar Todo"}
              </button>
            </div>
          </div>
        </div>

        {/* --- SECCIÓN INFERIOR: LISTA DE COMMITS --- */}
        <div
          className="glass-card"
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            maxWidth: "100%",
          }}
        >
          <div style={{ marginBottom: "15px" }}>
            <h3
              className="section-title"
              style={{ fontSize: "1.4rem", margin: 0, textAlign: "left" }}
            >
              Commits en {branch}
            </h3>
          </div>

          <div style={{ overflowY: "auto", flex: 1, paddingRight: "5px" }}>
            {commitsList.map((commit) => (
              <div
                key={commit.sha}
                className="commit-row"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "16px",
                  borderBottom: "1px solid var(--border-color)",
                  background:
                    analysisStatus[commit.sha]?.status === "running"
                      ? "rgba(62, 139, 255, 0.05)"
                      : "transparent",
                  transition: "background 0.2s",
                }}
              >
                <div
                  style={{
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                    marginRight: "15px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "monospace",
                        background: "var(--bg-color)",
                        padding: "2px 6px",
                        borderRadius: "4px",
                        color: "var(--brand-blue)",
                        fontWeight: "bold",
                      }}
                    >
                      {commit.sha.substring(0, 7)}
                    </span>
                    <span
                      style={{ color: "var(--text-primary)", fontWeight: 600 }}
                    >
                      {commit.commit || "Sin mensaje"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: "0.9rem",
                      color: "var(--text-secondary)",
                      marginTop: "4px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={commit.commit}
                  >
                    {commit.author || "Autor desconocido"}
                  </div>
                </div>
                <div style={{ minWidth: "160px", textAlign: "right" }}>
                  {renderCommitAction(commit)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
};

ProcessingPage.propTypes = {
  history: PropTypes.object.isRequired,
  location: PropTypes.object.isRequired,
};

export default withRouter(ProcessingPage);
