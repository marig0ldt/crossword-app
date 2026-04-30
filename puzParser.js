// puzParser.js - Krossvord fayllarını oxumaq üçün təmiz parser
function parsePuz(buffer) {
  try {
    // Krossvord faylının formatını yoxlayırıq
    const magic = buffer.toString('latin1', 2, 14);
    if (magic !== 'ACROSS&DOWN\0') {
      console.warn("Yanlış .puz fayl formatı");
      return null;
    }

    // Ölçüləri və sual sayını oxuyuruq
    const width = buffer.readUInt8(0x2C);
    const height = buffer.readUInt8(0x2D);
    const numClues = buffer.readUInt16LE(0x2E);

    // Həlləri oxuyuruq
    const gridStart = 0x34;
    const gridEnd = gridStart + (width * height);
    const solutionString = buffer.toString('latin1', gridStart, gridEnd);
    
    const stateEnd = gridEnd + (width * height);

    // Mətnləri (Başlıq, Müəllif və Suallar) oxuyan funksiya
    let offset = stateEnd;
    function readString() {
      let end = offset;
      while (end < buffer.length && buffer[end] !== 0x00) {
        end++;
      }
      const str = buffer.toString('latin1', offset, end);
      offset = end + 1; // null baytını keçirik
      return str;
    }

    const title = readString();
    const author = readString();
    const copyright = readString();

    // Sualları (clues) toplayırıq
    const clues = [];
    for (let i = 0; i < numClues; i++) {
      clues.push(readString());
    }

    // 2D grid (cədvəl) yaradırıq
    const grid = [];
    for (let r = 0; r < height; r++) {
      const row = [];
      for (let c = 0; c < width; c++) {
        let char = solutionString[r * width + c];
        // .puz fayllarında qara xanalar '.' ilə işarələnir, onu '#' edirik ki oyunumuzla uyğun gəlsin
        if (char === '.') char = '#'; 
        row.push(char);
      }
      grid.push(row);
    }

    return {
      title: title || "Başlıqsız",
      author: author || "Naməlum",
      width,
      height,
      grid,
      clues
    };
  } catch (err) {
    console.error(".puz faylını oxuyarkən xəta:", err);
    return null;
  }
}

// Yalnız parsePuz funksiyasını serverə göndəririk
module.exports = { parsePuz };