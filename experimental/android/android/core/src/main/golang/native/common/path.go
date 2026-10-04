package common

import "strings"

func ResolveAsRoot(path string) string {
	directories := strings.Split(path, "/")
	result := make([]string, 0, len(directories))

	for _, directory := range directories {
		switch directory {
		case "", ".":
			continue
		case "..":
			if len(result) > 0 {
				result = result[:len(result)-1]
			}
		default:
			result = append(result, directory)
		}
	}

	return strings.Join(result, "/")
}
