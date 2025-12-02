package analyzer

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"

	"gocity-analyzer/pkg/lib" // Importación local

	log "github.com/sirupsen/logrus"
)

type Analyzer interface {
	Analyze() (map[string]*NodeInfo, error)
}

type analyzer struct {
	rootPath    string
	IgnoreNodes []string
}

type Option func(a *analyzer)

func NewAnalyzer(rootPath string, options ...Option) Analyzer {
	analyzer := &analyzer{
		rootPath: rootPath,
	}

	for _, option := range options {
		option(analyzer)
	}

	return analyzer
}

func WithIgnoreList(files ...string) Option {
	return func(a *analyzer) {
		a.IgnoreNodes = files
	}
}

func (a *analyzer) IsInvalidPath(path string) bool {
	for _, value := range a.IgnoreNodes {
		return strings.Contains(path, value)
	}
	return false
}

func (a *analyzer) Analyze() (map[string]*NodeInfo, error) {
	summary := make(map[string]*NodeInfo)
	err := filepath.Walk(a.rootPath, func(path string, f os.FileInfo, err error) error {
		if err != nil {
			return fmt.Errorf("error on file walk: %s", err)
		}

		fileSet := token.NewFileSet()
		if f.IsDir() || !lib.IsGoFile(f.Name()) || a.IsInvalidPath(path) {
			return nil
		}
		
		// Calcular la ruta relativa para usarla como identificador
		// Esto reemplaza la lógica de TmpFolder y PackageName
		relPath, err := filepath.Rel(a.rootPath, path)
		if err != nil {
			log.WithField("path", path).Warn("No se pudo calcular la ruta relativa")
			relPath = path // Usar la ruta completa como fallback
		}
		// Asegurarse de que use '/' como en Go, no '\' de Windows
		relPath = filepath.ToSlash(relPath)

		file, err := parser.ParseFile(fileSet, path, nil, parser.ParseComments)
		if err != nil {
			log.WithField("file", path).Warn(err)
			return nil
		}

		v := &Visitor{
			FileSet:    fileSet,
			Path:       relPath, // Pasamos la ruta relativa
			StructInfo: summary,
		}

		ast.Walk(v, file)
		if err != nil {
			return fmt.Errorf("error on walk: %s", err)
		}

		return nil
	})

	return summary, err
}