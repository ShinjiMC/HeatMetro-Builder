// src/HomePage.js
import React, { useState } from "react";
import { withRouter } from "react-router-dom";
import PropTypes from "prop-types";
import axios from "axios";
import Navbar from "./Nav";
import Loading from "./Loading";

const API_URL = "/api/gh"; //const API_URL = "http://localhost:3000";

const HomePage = ({ history }) => {
  const [repository, setRepository] = useState("github.com/sourcegraph/conc");
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [error, setError] = useState("");

  const [availableRefs, setAvailableRefs] = useState(null);
  const [selectionType, setSelectionType] = useState("branches");
  const [selectionName, setSelectionName] = useState("");

  const handleFetchRefs = async () => {
    if (!repository) return;
    setLoadingRefs(true);
    setError("");
    setAvailableRefs(null);
    setSelectionName("");

    try {
      const response = await axios.post(`${API_URL}/github/refs`, {
        repoUrl: repository,
      });
      setAvailableRefs(response.data);
      // Auto-selección inteligente
      if (response.data.branches && response.data.branches.length > 0) {
        setSelectionType("branches");
        setSelectionName(response.data.branches[0]);
      } else if (response.data.tags && response.data.tags.length > 0) {
        setSelectionType("tags");
        setSelectionName(response.data.tags[0]);
      }
    } catch (err) {
      console.error(err);
      setError("No pudimos encontrar ese repositorio. Verifica la URL.");
    }
    setLoadingRefs(false);
  };

  const handleAnalyze = async () => {
    setLoadingCommits(true);
    setError("");

    try {
      const response = await axios.post(`${API_URL}/github/history`, {
        repoUrl: repository,
        selectionType: selectionType,
        selectionName: selectionName,
      });

      const commitsToProcess = response.data.commits;

      if (!commitsToProcess || commitsToProcess.length === 0) {
        setError("Este rango no tiene commits recientes para analizar.");
        setLoadingCommits(false);
        return;
      }

      history.push("/process", {
        repo: repository,
        branch: selectionName,
        commits: commitsToProcess,
        selectionType: selectionType,
      });
    } catch (err) {
      console.error(err);
      setError(
        "Error obteniendo el historial. Intenta con un repo más pequeño."
      );
      setLoadingCommits(false);
    }
  };

  // Obtener opciones actuales basadas en el tipo seleccionado
  const selectionOptions = availableRefs
    ? availableRefs[selectionType] || []
    : [];

  return (
    <main>
      <Navbar />

      <div className="home-container">
        <div className="glass-card">
          <div style={{ marginBottom: "30px" }}>
            <h2 className="section-title">Analizar Código</h2>
            <p className="section-description">
              Visualiza la evolución de cualquier repositorio público
            </p>
          </div>

          {/* PASO 1: Repositorio */}
          <div className="field-group">
            <label className="label-text" htmlFor="repo">
              Repositorio GitHub
            </label>
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                id="repo"
                className="input-modern"
                type="text"
                placeholder="ej: github.com/facebook/react"
                value={repository}
                onChange={(e) => setRepository(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFetchRefs()}
              />
            </div>
          </div>

          {!availableRefs && (
            <button
              className="btn-primary"
              onClick={handleFetchRefs}
              disabled={loadingRefs || !repository}
            >
              {loadingRefs ? "Buscando..." : "Buscar Repositorio"}
            </button>
          )}

          {/* Feedback de Carga Inicial */}
          {loadingRefs && (
            <div style={{ marginTop: "20px" }}>
              <Loading dark={true} message="Conectando con GitHub..." />
            </div>
          )}

          {/* PASO 2: Configuración (Aparece tras buscar) */}
          {availableRefs && (
            <div
              className="fade-in-up"
              style={{
                marginTop: "30px",
                borderTop: "1px solid var(--border-color)",
                paddingTop: "30px",
              }}
            >
              <label className="label-text" htmlFor="origin-select">
                Seleccionar Origen
              </label>

              {/* Toggle Personalizado Branch/Tag */}
              <div className="toggle-container">
                <button
                  className={`toggle-btn ${
                    selectionType === "branches" ? "active" : ""
                  }`}
                  onClick={() => {
                    setSelectionType("branches");
                    if (availableRefs.branches[0])
                      setSelectionName(availableRefs.branches[0]);
                  }}
                >
                  Branches ({availableRefs.branches.length})
                </button>
                <button
                  className={`toggle-btn ${
                    selectionType === "tags" ? "active" : ""
                  }`}
                  onClick={() => {
                    setSelectionType("tags");
                    if (availableRefs.tags[0])
                      setSelectionName(availableRefs.tags[0]);
                  }}
                >
                  Tags ({availableRefs.tags.length})
                </button>
              </div>

              {/* Select Dinámico */}
              <div className="field-group">
                <select
                  className="select-modern"
                  value={selectionName}
                  onChange={(e) => setSelectionName(e.target.value)}
                  disabled={selectionOptions.length === 0}
                >
                  {selectionOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Botón Final */}
              <button
                className="btn-primary"
                onClick={handleAnalyze}
                disabled={loadingCommits || !selectionName}
              >
                {loadingCommits ? "Analizando..." : "Generar Visualización"}
              </button>
            </div>
          )}

          {/* Mensajes de Estado */}
          {error && (
            <div
              style={{
                marginTop: "20px",
                padding: "12px",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
                textAlign: "center",
                fontSize: "0.9rem",
              }}
            >
              {error}
            </div>
          )}

          {loadingCommits && (
            <div style={{ marginTop: "20px" }}>
              <Loading dark={true} message="Descargando historia..." />
            </div>
          )}
        </div>
      </div>
    </main>
  );
};

HomePage.propTypes = {
  history: PropTypes.shape({ push: PropTypes.func.isRequired }).isRequired,
};

export default withRouter(HomePage);
