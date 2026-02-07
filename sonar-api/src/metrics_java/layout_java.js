const fs = require("fs");
const path = require("path");
const { minimatch } = require("minimatch");

// --- 1. PORTING DE position.go (Lógica matemática de posición) ---

class Generator {
  constructor(numberNodes) {
    this.numberNodes = numberNodes;
    this.dimension = Math.ceil(Math.sqrt(numberNodes));
    this.xReference = 0;
    this.yReference = 0;
    this.currentIndex = 0;
    this.maxWidth = 0;
    this.maxHeight = 0;
    this.defaultMargin = 1;
  }

  getBounds() {
    return {
      x: this.maxWidth + this.defaultMargin,
      y: this.maxHeight + this.defaultMargin,
    };
  }

  nextPosition(width, height) {
    this.currentIndex++;

    // Lógica de salto de línea (packing)
    if (
      this.currentIndex > this.dimension &&
      this.yReference + height >= this.maxWidth
    ) {
      this.currentIndex = 0;
      this.yReference = 0;
      this.xReference = this.maxWidth + this.defaultMargin;
    }

    const position = {
      x: this.xReference + (width + this.defaultMargin) / 2,
      y: this.yReference + (height + this.defaultMargin) / 2,
    };

    if (this.xReference + width > this.maxWidth) {
      this.maxWidth = this.xReference + width;
    }

    if (this.yReference + height > this.maxHeight) {
      this.maxHeight = this.yReference + height;
    }

    this.yReference += height + this.defaultMargin;

    return position;
  }
}

// --- 2. PORTING DE node.go (Estructura de Árbol y Cálculo de Dimensiones) ---

const NodeType = {
  STRUCT: "STRUCT",
  FILE: "FILE",
  PACKAGE: "PACKAGE",
};

class Node {
  constructor(name, type, fullPath) {
    this.name = name;
    this.type = type;
    this.fullPath = fullPath;

    // Dimensiones
    this.width = 0;
    this.depth = 0;
    this.childWidth = 0;
    this.childDepth = 0;
    this.childPosition = { x: 0, y: 0 };

    // Métricas
    this.numberOfLines = 0;
    this.numberOfMethods = 0;
    this.numberOfAttributes = 0;

    this.children = [];
    this.childrenMap = {};
  }

  // Acumula métricas desde las hojas hacia la raíz
  accumulateMetrics() {
    if (this.children.length === 0) return;

    for (const child of this.children) {
      child.accumulateMetrics();
      // Solo sumamos métricas "sumables". En tu Go sumabas todo hacia arriba.
      this.numberOfLines += child.numberOfLines;
      this.numberOfMethods += child.numberOfMethods;
      this.numberOfAttributes += child.numberOfAttributes;
    }
  }

  generateFlatChildrenPosition() {
    // Caso Base: Edificio (Clase/Struct)
    if (this.type === NodeType.STRUCT) {
      const size = this.numberOfAttributes + 1;
      this.width = size;
      this.depth = size;
      this.childWidth = size;
      this.childDepth = size;
      return;
    }

    // Si es carpeta vacía
    if (this.children.length === 0) {
      const size = this.numberOfAttributes + 1; // Fallback
      this.width = size;
      this.depth = size;
      this.childWidth = size;
      this.childDepth = size;
      return;
    }

    // Procesar hijos recursivamente primero
    for (const child of this.children) {
      child.generateFlatChildrenPosition();

      // Lógica específica de tu Go: Si es PACKAGE, forzamos dimensiones visuales a 5
      // para que el algoritmo de ordenamiento los trate igual.
      if (child.type === NodeType.PACKAGE) {
        child.childWidth = 5;
        child.childDepth = 5;
      }
    }

    // Ordenar hijos por tamaño (Mayor a menor) - Equivalente a sort.go
    this.children.sort((a, b) => {
      if (b.childWidth !== a.childWidth) {
        return b.childWidth - a.childWidth; // Sort by Width DESC
      }
      return a.name.localeCompare(b.name); // Sort by Name ASC
    });

    // Aplicar algoritmo de posición (Generator)
    const generator = new Generator(this.children.length);

    for (const child of this.children) {
      const pos = generator.nextPosition(child.childWidth, child.childDepth);
      child.childPosition = pos;
    }

    const bounds = generator.getBounds();
    this.width = bounds.x;
    this.depth = bounds.y;

    // Centrar hijos (ajuste de coordenadas relativas al centro del padre)
    for (const child of this.children) {
      child.childPosition.x -= this.width / 2.0;
      child.childPosition.y -= this.depth / 2.0;
    }

    // Ajuste especial para archivos (File Container)
    if (this.type === NodeType.FILE) {
      this.width += this.numberOfAttributes;
      this.depth += this.numberOfAttributes;
    }

    this.childWidth = this.width;
    this.childDepth = this.depth;
  }

  // --- Generación de Salida (Formato Columnas) ---
  flattenToString() {
    // Cabecera
    let output = "";
    output +=
      pad("Path", 70) +
      pad("Type", 10) +
      pad("Root_W", 10) +
      pad("Root_D", 10) +
      pad("Child_W", 10) +
      pad("Child_D", 10) +
      pad("Child_X", 10) +
      pad("Child_Y", 10) +
      pad("Lines", 10) +
      pad("Methods", 10) +
      pad("Attrs", 10) +
      "\n";
    output += "-".repeat(170) + "\n";

    // Root Node
    output += this.formatLine(
      "/",
      this.type,
      this.width,
      this.depth,
      "N/A",
      "N/A",
      "N/A",
      "N/A",
      this.numberOfLines,
      this.numberOfMethods,
      this.numberOfAttributes
    );

    // Hijos recursivos
    output += this.flattenRecursive(this.fullPath + "/");
    return output;
  }

  flattenRecursive(prefix) {
    let buffer = "";
    for (const child of this.children) {
      let displayPath = child.fullPath;
      if (displayPath.startsWith(prefix)) {
        displayPath = displayPath.substring(prefix.length);
      } else if (displayPath.startsWith(this.name + "/")) {
        // Ajuste por si el root path difiere
        displayPath = child.fullPath.substring(this.fullPath.length + 1);
      }

      buffer += this.formatLine(
        displayPath,
        child.type,
        child.width,
        child.depth,
        child.childWidth,
        child.childDepth,
        child.childPosition.x,
        child.childPosition.y,
        child.numberOfLines,
        child.numberOfMethods,
        child.numberOfAttributes
      );

      if (child.children.length > 0) {
        buffer += child.flattenRecursive(prefix);
      }
    }
    return buffer;
  }

  formatLine(pathStr, type, rw, rd, cw, cd, cx, cy, lines, meth, attrs) {
    const f = (val) => (typeof val === "number" ? val.toFixed(2) : val);
    return (
      pad(pathStr, 150) +
      pad(type, 10) +
      pad(f(rw), 10) +
      pad(f(rd), 10) +
      pad(f(cw), 10) +
      pad(f(cd), 10) +
      pad(f(cx), 10) +
      pad(f(cy), 10) +
      pad(lines, 10) +
      pad(meth, 10) +
      pad(attrs, 10) +
      "\n"
    );
  }

  flattenToObject(results) {
    // 1. Procesar el Root Node (Path "/")
    // Esto equivale a la línea: output += this.formatLine("/", ...)
    results.layout.push({
      path: "/",
      type: this.type,
      root_w: this.width,
      root_d: this.depth,
      child_w: 0, // Equivalente a N/A
      child_d: 0, // Equivalente a N/A
      child_x: 0, // Equivalente a N/A
      child_y: 0, // Equivalente a N/A
    });

    results.cohesion.push({
      file_path: "/",
      type: this.type,
      loc: this.numberOfLines,
      method_count: this.numberOfMethods,
      attr_count: this.numberOfAttributes,
    });

    // 2. Iniciar recursión para los hijos
    // El prefijo se usa para recortar el nombre del proyecto de la ruta
    // (ej: "Proyecto/src/main..." -> "src/main...")
    const prefix = this.fullPath + "/";
    this._flattenRecursive(results, prefix);
  }

  // Helper recursivo (Equivalente a flattenRecursive)
  _flattenRecursive(results, prefix) {
    for (const child of this.children) {
      // Cálculo del path relativo (Display Path)
      let displayPath = child.fullPath;
      if (displayPath.startsWith(prefix)) {
        displayPath = displayPath.substring(prefix.length);
      }

      // Agregar entrada de Layout
      results.layout.push({
        path: displayPath,
        type: child.type,
        root_w: child.width,
        root_d: child.depth,
        child_w: child.childWidth || 0,
        child_d: child.childDepth || 0,
        child_x: child.childPosition.x,
        child_y: child.childPosition.y,
      });

      // Agregar entrada de Cohesion
      results.cohesion.push({
        file_path: displayPath,
        type: child.type,
        loc: child.numberOfLines,
        method_count: child.numberOfMethods,
        attr_count: child.numberOfAttributes,
      });

      // Recursión si tiene hijos
      if (child.children.length > 0) {
        child._flattenRecursive(results, prefix);
      }
    }
  }
}

// Helper para formato de columnas (como fmt.Sprintf("%-70s"))
function pad(str, len) {
  str = String(str);
  if (str.length >= len) return str.substring(0, len - 1) + " ";
  return str + " ".repeat(len - str.length);
}

// --- 3. PARSER JAVA (Versión Definitiva: Limpieza de Métodos) ---

// Helper para extraer el cuerpo exacto por llaves balanceadas
function extractBlock(text, startIndex) {
  let openBraces = 0;
  let started = false;
  let endIndex = text.length;
  for (let i = startIndex; i < text.length; i++) {
    if (text[i] === "{") {
      openBraces++;
      started = true;
    } else if (text[i] === "}") {
      openBraces--;
    }
    if (started && openBraces === 0) {
      endIndex = i + 1;
      break;
    }
  }
  return text.substring(startIndex, endIndex);
}

// NUEVO HELPER: Elimina el contenido de los métodos para no contar variables locales
function removeMethodBodies(classBodyContent) {
  let result = "";
  let i = 0;
  while (i < classBodyContent.length) {
    if (classBodyContent[i] === "{") {
      // Encontramos el inicio de un bloque (método, static block, etc.)
      // Avanzamos hasta su cierre y lo ignoramos
      let openBraces = 1;
      i++;
      while (i < classBodyContent.length && openBraces > 0) {
        if (classBodyContent[i] === "{") openBraces++;
        if (classBodyContent[i] === "}") openBraces--;
        i++;
      }
      // Reemplazamos el cuerpo con un punto y coma ficticio para no romper el parsing visual
      result += ";";
    } else {
      result += classBodyContent[i];
      i++;
    }
  }
  return result;
}

function parseJavaFile(filePath, rootPath) {
  let content = "";
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return null;
  }

  // 1. Detectar Paquete
  const packageMatch = content.match(/^\s*package\s+([\w\.]+)\s*;/m);
  let packageName = packageMatch ? packageMatch[1] : "";

  // 2. Limpieza de comentarios
  const cleanCode = content
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");

  const classes = [];
  const classPattern = /\b(class|interface|enum|record)\s+([A-Z]\w*)/g;

  // Regex estricto para atributos: Requiere modificador o estructura clara de Tipo Nombre;
  // Evita capturar saltos de línea basura.
  const attrPattern =
    /\b(?:public|private|protected|static|final|volatile|transient)\s+[\w<>[\]]+\s+\w+(\s*=.*?)?;/g;

  // Regex para métodos (para conteo)
  const methodPattern =
    /(?:public|private|protected|static|final|native|synchronized|abstract|\s)+[\w\<\>\[\]]+\s+\w+\s*\(.*?\)\s*(?:throws\s+[\w,\s]+\s*)?\{/g;

  let match;
  while ((match = classPattern.exec(cleanCode)) !== null) {
    const className = match[2];
    const startIndex = match.index;

    // A. Extraemos el bloque de la clase
    let classBody = extractBlock(cleanCode, startIndex);

    // B. Obtenemos el contenido interior (sin los corchetes de la clase misma)
    let bodyContent = classBody.substring(
      classBody.indexOf("{") + 1,
      classBody.lastIndexOf("}")
    );

    // C. LIMPIEZA DE ANIDADOS (Igual que antes)
    let nestedMatch;
    while ((nestedMatch = classPattern.exec(bodyContent)) !== null) {
      const nestedBlock = extractBlock(bodyContent, nestedMatch.index);
      bodyContent = bodyContent.replace(nestedBlock, "");
      classPattern.lastIndex = 0;
    }

    // D. MÉTRICAS
    const loc = classBody.split("\n").filter((l) => l.trim() !== "").length;

    // Contamos métodos ANTES de borrar sus cuerpos (porque el regex busca la firma + '{')
    const methods = (bodyContent.match(methodPattern) || []).length;

    // E. LIMPIEZA DE CUERPOS DE MÉTODOS (NUEVO PASO CRÍTICO)
    // Esto elimina las variables locales. "int x = 1;" dentro de un método desaparecerá.
    const fieldsOnlyContent = removeMethodBodies(bodyContent);

    // Contamos atributos sobre el código limpio (solo quedan declaraciones de clase)
    const attributes = (fieldsOnlyContent.match(attrPattern) || []).length;

    classes.push({
      name: className,
      type: "STRUCT",
      loc: loc,
      methods: methods,
      attributes: attributes,
    });

    classPattern.lastIndex = startIndex + 1;
  }

  if (classes.length === 0) {
    const loc = cleanCode.split("\n").filter((l) => l.trim() !== "").length;
    classes.push({
      name: path.basename(filePath, ".java"),
      type: "STRUCT",
      loc: loc,
      methods: 0,
      attributes: 0,
    });
  }

  return { packageName, fileName: path.basename(filePath), classes };
}

// --- 4. MAIN LOOP (Orquestador) ---

async function getLayoutMetrics(rootPath, exclusions = []) {
  console.log(`🏙️ [JAVA] Generando City Layout en: ${rootPath}`);
  const projectName = path.basename(rootPath);
  console.log(`Analizando: ${projectName} en ${rootPath}`);

  // Crear nodo raíz (PACKAGE)
  const rootNode = new Node(projectName, NodeType.PACKAGE, projectName);

  // Recorrer archivos recursivamente
  function walkDir(dir) {
    let list = [];
    try {
      list = fs.readdirSync(dir);
    } catch (e) {
      return;
    }
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const relativePath = path.relative(rootPath, fullPath);
      if (exclusions && exclusions.length > 0) {
        const isExcluded = exclusions.some((pattern) =>
          minimatch(relativePath, pattern, { dot: true, matchBase: true })
        );
        if (isExcluded) continue;
      }
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        walkDir(fullPath);
      } else if (file.endsWith(".java")) {
        processFile(fullPath);
      }
    }
  }

  function processFile(filePath) {
    const data = parseJavaFile(filePath, rootPath);
    if (!data) return;

    // 1. Obtener la ruta relativa real (ej: "src/main/java/org/jsoup/nodes/Node.java")
    // Esto reemplaza la lógica de "package" para respetar la estructura de carpetas
    const relativePath = path
      .relative(rootPath, filePath)
      .split(path.sep)
      .join("/");

    // Dividimos en partes: ["src", "main", "java", "org", "jsoup", "nodes", "Node.java"]
    const pathParts = relativePath.split("/");
    const fileName = pathParts[pathParts.length - 1];
    const folderParts = pathParts.slice(0, -1);

    // 2. Construir la Jerarquía de Carpetas (Packages/Directories)
    let currentNode = rootNode;
    let currentPath = rootNode.fullPath; // Empezamos desde el nombre del proyecto

    for (const part of folderParts) {
      currentPath = currentPath + "/" + part;

      if (!currentNode.childrenMap[part]) {
        const newPkg = new Node(part, NodeType.PACKAGE, currentPath);
        currentNode.childrenMap[part] = newPkg;
        currentNode.children.push(newPkg);
      }
      currentNode = currentNode.childrenMap[part];
    }

    // 3. Crear el Nodo ARCHIVO
    const fileNodePath = currentPath + "/" + fileName;

    if (!currentNode.childrenMap[fileName]) {
      const newFile = new Node(fileName, NodeType.FILE, fileNodePath);
      currentNode.childrenMap[fileName] = newFile;
      currentNode.children.push(newFile);
    }
    currentNode = currentNode.childrenMap[fileName];

    // 4. Crear Nodos de CLASES (Structs) dentro del archivo
    for (const cls of data.classes) {
      const structName = cls.name;
      const structPath = fileNodePath + ".(" + structName + ")";

      if (!currentNode.childrenMap[structName]) {
        const newStruct = new Node(structName, NodeType.STRUCT, structPath);
        newStruct.numberOfLines = cls.loc;
        newStruct.numberOfMethods = cls.methods;
        newStruct.numberOfAttributes = cls.attributes;

        currentNode.childrenMap[structName] = newStruct;
        currentNode.children.push(newStruct);
      }
    }
  }

  walkDir(rootPath);

  rootNode.accumulateMetrics();
  rootNode.generateFlatChildrenPosition();
  const results = { layout: [], cohesion: [] };
  rootNode.flattenToObject(results);
  console.log(`✅ Layout calculado: ${results.layout.length} elementos.`);
  return results;
}

module.exports = { getLayoutMetrics };
