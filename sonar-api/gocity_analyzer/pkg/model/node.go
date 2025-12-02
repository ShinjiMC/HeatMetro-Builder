package model

import (
	"fmt"
	"sort"
	"strings"

	"gocity-analyzer/pkg/analyzer"
	"gocity-analyzer/pkg/lib"
)

type NodeType string

const (
	StructType  NodeType = "STRUCT"
	FileType    NodeType = "FILE"
	PackageType NodeType = "PACKAGE"
)

type Node struct {
	Name     string `json:"name"`
	FullPath string `json:"-"`
	Type     NodeType `json:"type"`

	Width float64 `json:"width"`
	Depth float64 `json:"depth"`

	ChildWidth    float64  `json:"childWidth"`
	ChildDepth    float64  `json:"childDepth"`
	ChildPosition Position `json:"childPosition"`

	NumberOfLines      int `json:"numberOfLines"`
	NumberOfMethods    int `json:"numberOfMethods"`
	NumberOfAttributes int `json:"numberOfAttributes"`

	Children    []*Node `json:"children"`
	Line        int     `json:"-"`
	childrenMap map[string]*Node
}

func (n *Node) GenerateChildList() {
	for _, child := range n.childrenMap {
		n.Children = append(n.Children, child)
		if len(child.childrenMap) > 0 {
			child.GenerateChildList()
		}
	}
}

func (n *Node) GenerateFlatChildrenPosition() {
	if n.Type == StructType {
		size := float64(n.NumberOfAttributes) + 1
		n.Width = size
		n.Depth = size
		n.ChildWidth = size
		n.ChildDepth = size
		return
	}
	if len(n.Children) == 0 {
		size := float64(n.NumberOfAttributes) + 1
		n.Width = size
		n.Depth = size
		n.ChildWidth = size
		n.ChildDepth = size
		return
	}

	for _, child := range n.Children {
		child.GenerateFlatChildrenPosition()

		if child.Type == PackageType {
			child.ChildWidth = 5
			child.ChildDepth = 5
		}
	}

	sort.Sort(sort.Reverse(byChildWidth(n.Children)))

	positionGenerator := NewGenerator(len(n.Children))
	for _, child := range n.Children {
		child.ChildPosition = positionGenerator.NextPosition(child.ChildWidth, child.ChildDepth)
	}

	bounds := positionGenerator.GetBounds()
	n.Width, n.Depth = bounds.X, bounds.Y

	for _, child := range n.Children {
		child.ChildPosition.X -= n.Width / 2.0
		child.ChildPosition.Y -= n.Depth / 2.0
	}

	if n.Type == FileType {
		n.Width += float64(n.NumberOfAttributes)
		n.Depth += float64(n.NumberOfAttributes)
	}

	n.ChildWidth = n.Width
	n.ChildDepth = n.Depth
}

func getPathAndFile(fullPath string) (paths []string, fileName, structName string) {
	pathlist := strings.Split(fullPath, "/")
	paths = pathlist[:len(pathlist)-1]
	fileName, structName = lib.GetFileAndStruct(pathlist[len(pathlist)-1])
	return
}

func New(items map[string]*analyzer.NodeInfo, repositoryName string) *Node {
	tree := &Node{
		Name:        repositoryName,
		FullPath:    repositoryName,
		Type:        PackageType,
		childrenMap: make(map[string]*Node),
		Children:    make([]*Node, 0),
	}

	for key, value := range items {
		currentNode := tree
		paths, fileName, structName := getPathAndFile(key)
		currentPath := repositoryName
		for _, path := range paths {
			if path == "" {
				continue
			}
			nodePath := currentPath + "/" + path
			_, ok := currentNode.childrenMap[path]
			if !ok {
				currentNode.childrenMap[path] = &Node{
					Name:        path,
					FullPath:    nodePath,
					Type:        PackageType,
					childrenMap: make(map[string]*Node),
				}
			}
			currentNode = currentNode.childrenMap[path]
			currentPath = nodePath
		}
		fileNodePath := currentPath + "/" + fileName
		_, ok := currentNode.childrenMap[fileName]
		if !ok {
			currentNode.childrenMap[fileName] = &Node{
				Name:        fileName,
				FullPath:    fileNodePath,
				Type:        FileType,
				childrenMap: make(map[string]*Node),
			}
		}
		fileNode := currentNode.childrenMap[fileName]
		if len(structName) > 0 {
			structNodePath := fileNodePath + ".(" + structName + ")"
			structNode, ok := fileNode.childrenMap[structName]
			if !ok {
				fileNode.childrenMap[structName] = &Node{
					Name:               structName,
					FullPath:           structNodePath,
					Type:               StructType,
					Line:               value.Line,
					NumberOfAttributes: value.NumberAttributes,
					NumberOfMethods:    value.NumberMethods,
					NumberOfLines:      value.NumberLines,
				}
			} else {
				structNode.NumberOfAttributes += value.NumberAttributes
				structNode.NumberOfLines += value.NumberLines
				structNode.NumberOfMethods += value.NumberMethods
			}
		} else {
			fileNode.NumberOfAttributes += value.NumberAttributes
			fileNode.NumberOfLines += value.NumberLines
			fileNode.NumberOfMethods += value.NumberMethods
		}
	}
	tree.GenerateChildList()
	tree.GenerateFlatChildrenPosition()
	tree.accumulateMetrics()
	return tree
}
func (n *Node) accumulateMetrics() {
    if len(n.Children) == 0 {
        return
    }
    for _, child := range n.Children {
        child.accumulateMetrics()
        n.NumberOfLines += child.NumberOfLines
        n.NumberOfMethods += child.NumberOfMethods
        n.NumberOfAttributes += child.NumberOfAttributes
    }
}
func (n *Node) FlattenToString() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("%-70s %-10s %-10s %-10s %-10s %-10s %-10s %-10s %-10s %-10s %-10s\n",
		"Path", "Type", "Root_W", "Root_D", "Child_W", "Child_D", "Child_X", "Child_Y", "Lines", "Methods", "Attrs"))
	b.WriteString(strings.Repeat("-", 170) + "\n")

	rootName := n.FullPath
	prefix := rootName + "/"
	b.WriteString(fmt.Sprintf("%-70s %-10s %-10.2f %-10.2f %-10s %-10s %-10s %-10s %-10d %-10d %-10d\n",
		"/",
		n.Type,
		n.Width,
		n.Depth,
		"N/A",
		"N/A",
		"N/A",
		"N/A",
		n.NumberOfLines,
		n.NumberOfMethods,
		n.NumberOfAttributes,
	))
	n.flattenRecursive(&b, prefix)
	return b.String()
}

func (n *Node) flattenRecursive(b *strings.Builder, prefix string) {
	for _, child := range n.Children {

		displayPath := strings.TrimPrefix(child.FullPath, prefix)
		b.WriteString(fmt.Sprintf("%-70s %-10s %-10.2f %-10.2f %-10.2f %-10.2f %-10.2f %-10.2f %-10d %-10d %-10d\n",
			displayPath,
			child.Type,
			child.Width,
			child.Depth,
			child.ChildWidth,
			child.ChildDepth,
			child.ChildPosition.X,
			child.ChildPosition.Y,
			child.NumberOfLines,
			child.NumberOfMethods,
			child.NumberOfAttributes,
		))
		if len(child.Children) > 0 {
			child.flattenRecursive(b, prefix)
		}
	}
}