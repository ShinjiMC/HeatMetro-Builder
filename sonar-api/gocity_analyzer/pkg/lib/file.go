package lib

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	regexpFile = regexp.MustCompile(`([^/]+\.go)(?:\.\((\w+)\))?$`)
)

func GetFileAndStruct(identifier string) (fileName, structName string) {
	result := regexpFile.FindStringSubmatch(identifier)
	if len(result) > 1 {
		fileName = result[1]
	}

	if len(result) > 2 {
		structName = result[2]
	}

	return
}

// Versión simplificada. Solo necesita la ruta y el nombre.
func GetIdentifier(path, name string) string {
	if len(name) > 0 {
		return fmt.Sprintf("%s.(%s)", path, name)
	}
	return path
}

func IsGoFile(name string) bool {
	return strings.HasSuffix(name, ".go")
}