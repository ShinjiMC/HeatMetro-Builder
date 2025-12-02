package main

import (
	"fmt"
	"os"
	"path/filepath"

	"gocity-analyzer/pkg/analyzer"
	"gocity-analyzer/pkg/model"

	log "github.com/sirupsen/logrus"
)

func main() {
	// --- MODIFICACIÓN 1: Configurar Logs ---
	// Enviamos los logs a Stderr para dejar el Stdout limpio para los datos
	log.SetOutput(os.Stderr)
	log.SetLevel(log.InfoLevel)

	if len(os.Args) < 2 {
		log.Fatal("Error: Debes proporcionar la ruta al proyecto.")
		return
	}
	localPath := os.Args[1]

	path, err := filepath.Abs(localPath)
	if err != nil {
		log.Fatalf("Error al obtener la ruta absoluta: %v", err)
	}

	stat, err := os.Stat(path)
	if os.IsNotExist(err) {
		log.Fatalf("La ruta no existe: %s", path)
	}
	if !stat.IsDir() {
		log.Fatalf("La ruta no es un directorio: %s", path)
	}

	projectName := filepath.Base(path)

	// --- MODIFICACIÓN 2: Lógica de Salida ---
	useStdout := false
	outName := fmt.Sprintf("%s.out", projectName)

	if len(os.Args) > 2 {
		if os.Args[2] == "STDOUT" {
			useStdout = true
		} else {
			outName = os.Args[2]
		}
	}

	log.Infof("Analizando proyecto local: %s", projectName)
	log.Infof("Ruta de entrada: %s", path)

	codeAnalyzer := analyzer.NewAnalyzer(path, analyzer.WithIgnoreList("/vendor/"))
	summary, err := codeAnalyzer.Analyze()
	if err != nil {
		log.Fatalf("Error al analizar el código: %v", err)
	}

	log.Info("Generando modelo de datos...")
	cityModel := model.New(summary, projectName)

	log.Info("Generando salida...")
	outputString := cityModel.FlattenToString()

	if useStdout {
		fmt.Print(outputString)
	} else {
		err = os.WriteFile(outName, []byte(outputString), 0644)
		if err != nil {
			log.Fatalf("Error al escribir el archivo de salida: %v", err)
		}
		log.Infof("¡Análisis completado! Archivo generado: %s", outName)
	}
}