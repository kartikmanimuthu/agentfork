const documentFileExtensions: string[] = [".doc", ".docx", ".txt", ".pdf"];

function isDocumentLink(url: string): boolean {
  return documentFileExtensions.some((ext) =>
    url.toLowerCase().includes(ext.toLowerCase())
  );
}

function createDocumentLink(url: string): string {
  return ` <a href="${url.trim()}" target="_blank" download>${url.trim()}</a>`;
}

export function scanForDocumentUrls(sentence: HTMLElement): HTMLElement {
  const urlRegex = /(https?:\/\/[^\s<]+)/g;
  let formattedText = sentence.innerHTML;

  formattedText = formattedText.replace(urlRegex, (url: string) => {
    if (isDocumentLink(url)) {
      return createDocumentLink(url);
    }
    return url;
  });

  sentence.innerHTML = formattedText;
  return sentence;
}

export function formatPlainLinks(sentence: HTMLElement): HTMLElement {
  const regex = /(?:^|\s)(https?:\/\/[^\s<]+)\.?/g;
  let formattedText = sentence.innerHTML.replace(
    regex,
    (match: string, url: string) => {
      const cleanUrl = url.trim().replace(/\.$/, "");
      if (isDocumentLink(cleanUrl)) {
        return cleanUrl;
      }
      return ` <a href="${cleanUrl}" target="_blank">${cleanUrl}</a>`;
    }
  );
  sentence.innerHTML = formattedText;
  return sentence;
}

export function formatMarkdownLinks(sentence: HTMLElement): HTMLElement {
  const regex = /\[\s*(.*?)\s*\]\(\s*(https?:\/\/[^\)]+)\s*\)/g;
  let formattedText = sentence.innerHTML.replace(
    regex,
    (_: string, label: string, url: string) => {
      if (isDocumentLink(url.trim())) {
        return `[${label}](${url})`;
      }
      const displayText = isNaN(Number(label)) ? label.trim() : url.trim();
      return ` <a href="${url.trim()}" target="_blank">${displayText}</a>`;
    }
  );
  sentence.innerHTML = formattedText;
  return sentence;
}

// Helper function to format italics
export function formatItalics(sentence: HTMLElement): HTMLElement {
  const regex = /\*(.*?)\*/g;
  let formattedText = sentence.innerHTML.replace(regex, "<em>$1</em>");
  sentence.innerHTML = formattedText;
  return sentence;
}

// Helper function to format bold text
export function formatBold(sentence: HTMLElement): HTMLElement {
  const regex = /\*\*(.*?)\*\*/g;
  let formattedText = sentence.innerHTML.replace(
    regex,
    (match: string, content: string) => {
      if (
        documentFileExtensions.some((ext) =>
          content.toLowerCase().includes(ext.toLowerCase())
        )
      ) {
        return match;
      }
      return `<strong>${content}</strong>`;
    }
  );
  sentence.innerHTML = formattedText;
  return sentence;
}

// Helper function for code blocks
export function formatCodeBlocks(sentence: HTMLElement): HTMLElement {
  const inlineCodeRegex = /`([^`]+)`/g;
  let formattedText = sentence.innerHTML.replace(
    inlineCodeRegex,
    "<code>$1</code>"
  );

  const blockCodeRegex = /```([^`]+)```/g;
  formattedText = formattedText.replace(
    blockCodeRegex,
    "<pre><code>$1</code></pre>"
  );

  sentence.innerHTML = formattedText;
  return sentence;
}

// Helper function to convert dashed sentences into bullet points
export function convertToBulletPoints(sentence: HTMLElement): HTMLElement {
  if (sentence.innerHTML.startsWith("- ")) {
    const li = document.createElement("li");
    li.innerHTML = sentence.innerHTML.replace("- ", "").trim();
    return li;
  }
  return sentence;
}

export function convertToOrderedList(sentence: HTMLElement): HTMLElement {
  const regex = /^\d+\.\s+/;
  if (regex.test(sentence.innerHTML)) {
    const li = document.createElement("li");
    li.innerHTML = sentence.innerHTML.replace(regex, "").trim();
    return li;
  }
  return sentence;
}

export function sentenceFormatting(message: string): HTMLUListElement {
  const container = document.createElement("ul");
  container.className = "sentenceContainer";

  const sentences = message.split("\n");

  sentences.forEach((sentenceText: string) => {
    const trimmedSentence = sentenceText.trim();
    if (!trimmedSentence) return;

    const p = document.createElement("p");
    p.textContent = trimmedSentence;

    let formatted: HTMLElement = p;
    formatted = scanForDocumentUrls(formatted);
    formatted = formatPlainLinks(formatted);
    formatted = formatMarkdownLinks(formatted);
    formatted = formatItalics(formatted);
    formatted = formatBold(formatted);
    formatted = formatCodeBlocks(formatted);

    const formattedElement =
      convertToBulletPoints(formatted) !== formatted
        ? convertToBulletPoints(formatted)
        : convertToOrderedList(formatted);

    container.appendChild(formattedElement);
  });

  return container;
}
