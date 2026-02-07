package analyzer

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"gocity-analyzer/pkg/lib"
	"os"
	"path/filepath"
	"strings"

	"github.com/bmatcuk/doublestar/v4"
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

func (a *analyzer) IsInvalidPath(absolutePath string) bool {
	relPath, err := filepath.Rel(a.rootPath, absolutePath)
	if err != nil {
		return false
	}
	relPath = filepath.ToSlash(relPath)
	for _, pattern := range a.IgnoreNodes {
		if pattern == "" {
			continue
		}
		cleanPattern := strings.TrimSpace(pattern)
		matched, _ := doublestar.Match(cleanPattern, relPath)
		if matched {
			return true
		}
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
		relPath, err := filepath.Rel(a.rootPath, path)
		if err != nil {
			log.WithField("path", path).Warn("No se pudo calcular la ruta relativa")
			relPath = path  
		}
		relPath = filepath.ToSlash(relPath)

		file, err := parser.ParseFile(fileSet, path, nil, parser.ParseComments)
		if err != nil {
			log.WithField("file", path).Warn(err)
			return nil
		}
		v := &Visitor{
			FileSet:    fileSet,
			Path:       relPath, 
			StructInfo: summary,
		}

		ast.Walk(v, file)
		return nil
	})

	return summary, err
}