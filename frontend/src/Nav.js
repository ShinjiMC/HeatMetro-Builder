// src/Nav.js
import React from "react";
import logo from "./img/logo.png"; // Asegúrate de que la extensión sea correcta (.jpg o .png según tu archivo)
import { useTheme } from "./useTheme";

const Nav = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <nav className="navbar-custom">
      <div style={{ display: "flex", alignItems: "center" }}>
        <a
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            textDecoration: "none",
          }}
        >
          <img
            width={40}
            src={logo}
            alt="HeatMetro Logo"
            style={{ borderRadius: "6px" }}
          />
          <span className="brand-title">HeatMetro</span>
        </a>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
        {/* GitHub Stats - Oculto en móviles muy pequeños */}
        <div
          className="is-hidden-mobile"
          style={{ display: "flex", gap: "10px" }}
        >
          <a href="https://github.com/ShinjiMC/HeatMetro-Builder">
            <img
              alt="Stars"
              src="https://img.shields.io/github/stars/ShinjiMC/HeatMetro-Builder?style=flat&color=FF7D00&labelColor=1a202c"
            />
          </a>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="theme-btn"
          aria-label="Cambiar modo"
        >
          {theme === "light" ? (
            // Icono Luna
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
          ) : (
            // Icono Sol
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
};

export default Nav;
