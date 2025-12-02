package model

import (
	"strings"
)

type byChildWidth []*Node

func (s byChildWidth) Len() int {
	return len(s)
}
func (s byChildWidth) Swap(i, j int) {
	s[i], s[j] = s[j], s[i]
}
func (s byChildWidth) Less(i, j int) bool {
	if s[i].ChildWidth < s[j].ChildWidth {
		return true
	}

	if s[i].ChildWidth > s[j].ChildWidth {
		return false
	}

	return strings.Compare(s[i].Name, s[j].Name) == -1
}