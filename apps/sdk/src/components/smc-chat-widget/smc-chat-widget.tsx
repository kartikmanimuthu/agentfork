import { Component, h, Fragment, State, Prop, Element } from "@stencil/core";
import { sentenceFormatting } from "../../utils/sentence";
import {
  Message,
  ChatApiResponse,
  ChatHistoryResponse,
  SessionConfig,
} from "../../types/message";


@Component({
  tag: "smc-chat-widget",
  styleUrl: "./smc-chat-widget.css",
  shadow: true,
})


export class ChatWidget {
  @Prop() userName?: string;
  @Prop() theme?: "light" | "dark" = "light";
  @Prop() position?: "left" | "right" = "right";
  @Prop() headerText?: string = "Chatbot Assistant";
  @Prop() welcomeMessage?: string = "Welcome to chat assistant";
  @Prop() botName?: string = "Bot";
  @Prop() headerIcon?: string = "";
  @Prop() startChatLogo?: string = "https://cdn-icons-png.flaticon.com/512/4712/4712027.png";
  @Prop() primaryColor?: string = "#2196f3";
  @Prop() secondaryColor?: string = "#1976d2";
  @Prop() inputPlaceholder?: string = "Type your message...";

  @Prop() apiUrl!: string;
  @Prop() session!: SessionConfig | string;
  @Prop() defaultOptions?: string = '[]';

  @State() messages: Message[] = [];
  @State() isOpen: boolean = false;
  @State() isMinimized: boolean = false;
  @State() isHidden: boolean = false;
  @State() showConfirmDialog: boolean = false;
  @State() isLoading: boolean = false;
  @State() feedbacks: Record<string, 'up' | 'down'> = {};

  @Element() el!: HTMLElement;

  private inputRef?: HTMLInputElement;

  private getDefaultOptions(): string[] {
    try {
      return JSON.parse(this.defaultOptions || '[]');
    } catch {
      return [];
    }
  }

  async componentWillLoad() {
    // Load theme from localStorage
    const savedTheme = localStorage.getItem('chatbot-theme');
    if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
      this.theme = savedTheme;
    }
    await this.loadChatHistoryApi();
  }

  private getHeaders(): Record<string, string> {
    let parsedSession: SessionConfig;

    if (typeof this.session === "string") {
      parsedSession = JSON.parse(this.session);
    } else {
      parsedSession = this.session;
    }

    if (!this.session) {
      throw new Error("Session configuration is required");
    }

    return {
      "Content-Type": "application/json",
      "x-api-key": parsedSession["x-api-key"] as string,
      "x-prompt-session-attribute": JSON.stringify(
        parsedSession["x-prompt-session-attribute"]
      ),
      "x-session-attribute": JSON.stringify(
        parsedSession["x-session-attribute"]
      ),
      "x-platform-agent": parsedSession["x-platform-agent"] as string,
    };
  }

  private async loadChatHistoryApi() {
    if (!this.session || !this.apiUrl) {
      throw new Error("Session and API URL configuration is required");
    }
    try {
      const response = await fetch(`${this.apiUrl}/history`, {
        method: "GET",
        credentials: "include",
        headers: this.getHeaders() as HeadersInit,
      });

      if (!response.ok) throw new Error("Failed to fetch chat history");

      const data = (await response.json()) as ChatHistoryResponse;

      // Convert history to messages
      this.messages = data.chatHistory.map((chat) => ({
        content: JSON.parse(chat.message).message,
        sender:
          chat.chatRole === "user"
            ? this.getUserDisplayName()
            : this.botName || "Bot",
        timestamp: new Date(parseInt(chat.timestamp)).toISOString(),
      }));

      // Add welcome message if no history
      if (this.messages.length === 0) {
        this.messages = [
          {
            content: this.welcomeMessage || "Welcome! How can I help you today?",
            sender: this.botName || "Bot",
            timestamp: new Date().toISOString(),
          },
        ];
      }
    } catch (error) {
      console.error("Failed to load chat history:", error);
      // Fall back to welcome message
      this.messages = [
        {
          content:
            this.welcomeMessage ||
            "Welcome! How can I help you today?",
          sender: this.botName || "Bot",
          timestamp: new Date().toISOString(),
        },
      ];
    }
  }

  private async fetchBotReplyAPi(userMessage: string) {
    try {
      const response = await fetch(this.apiUrl, {
        method: "POST",
        credentials: "include",
        headers: this.getHeaders() as HeadersInit,
        body: JSON.stringify({
          inputText: userMessage,
          role: "user",
        }),
      });

      if (!response.ok) throw new Error("API request failed");

      const data = (await response.json()) as ChatApiResponse;

      return data.response || "No response";
    } catch (error) {
      console.error("Chat API error:", error);
      return "Sorry, I encountered an error processing your request.";
    }
  }

  private async notifyCloseApi() {
    const sessionData = this.getHeaders();

    if (sessionData["x-session-attribute"]) {
      let sessionAtr = sessionData["x-session-attribute"];
      let parseDataAttr = JSON.parse(sessionAtr);

      let finalJsonHeader = JSON.stringify({
        ...parseDataAttr,
        endSession: true,
      });
      sessionData["x-session-attribute"] = finalJsonHeader;
    }

    if (this.apiUrl) {
      try {
        await fetch(`${this.apiUrl}`, {
          method: "POST",
          headers: sessionData as HeadersInit,
          body: JSON.stringify({
            inputText: "end",
            role: "user",
          }),
        });
      } catch (error) {
        console.error("Failed to notify chat close:", error);
      }
    }
  }

  componentDidRender() {
    if (this.isOpen && !this.isMinimized) {
      this.inputRef?.focus();
    }
  }

  private async addBotReply(userMessage: string) {
    this.isLoading = true;
    try {
      const reply = await this.fetchBotReplyAPi(userMessage);
      const botMessage: Message = {
        content: reply,
        sender: this.botName || "Bot",
        timestamp: new Date().toISOString()
      };

      const optionsMessage: Message = {
        content: "options",
        sender: this.botName || "Bot",
        timestamp: new Date().toISOString(),
        isOptions: true
      };

      this.messages = [...this.messages, botMessage, optionsMessage];
    } finally {
      this.isLoading = false;
      this.scrollToBottom();
    }
  }

  private validateAndSanitizeInput(input: string) {
    const bannedPatterns = [
      /ignore previous instructions/i,
      /system:.*?/i,
      /run (this|any) code/i,
      /give me (.*) password/i,
      /please forget all previous rules/i,
    ];

    for (let pattern of bannedPatterns) {
      if (pattern.test(input)) {
        throw new Error("Unsafe input detected!");
      }
    }

    // Allow only alphanumeric characters, spaces, and basic punctuation
    const sanitizedInput = input.replace(/[^a-zA-Z0-9 .,!?-]/g, "");

    // Check if input is empty or exceeds length limit
    if (sanitizedInput.trim() === "" || sanitizedInput.length > 150) {
      throw new Error(
        "Invalid input: Input must be between 1 and 150 characters."
      );
    }

    return sanitizedInput
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  private handleSendMessage(event: KeyboardEvent | MouseEvent) {
    if (this.isLoading) return;
    let input: HTMLInputElement | null = null;

    if (event instanceof KeyboardEvent) {
      if (event.key !== "Enter") return;
      input = event.target as HTMLInputElement;
    } else if (this.inputRef) {
      input = this.inputRef;
    }

    if (!input?.value?.trim()) return;

    const userDisplayName = this.getUserDisplayName();
    const message: Message = {
      content: input.value.trim(),
      sender: userDisplayName,
      timestamp: new Date().toISOString(),
    };

    this.messages = [...this.messages, message];
    input.value = "";
    this.scrollToBottom();

    try {
      const sanitizedInput = this.validateAndSanitizeInput(message.content);
      this.addBotReply(sanitizedInput);
    } catch (error) {
      this.addBotReply("Sorry, I can't process that request invalid input.");
    }
  }

  private scrollToBottom() {
    const messagesContainer = this.el.shadowRoot?.querySelector(".messages");
    if (messagesContainer) {
      setTimeout(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }, 100);
    }
  }

  private toggleChat = () => {
    if (!this.isOpen) {
      this.isOpen = true;
      this.isMinimized = false;
      this.isHidden = false;
      if (this.messages.length > 0) {
        setTimeout(() => this.scrollToBottom(), 100);
      }
    } else if (this.isHidden) {
      this.isHidden = false;
    } else if (this.isMinimized) {
      this.isMinimized = false;
    } else {
      this.isMinimized = true;
    }
  };

  private hideChat = () => {
    this.isHidden = true;
  };

  private closeChat = () => {
    this.showConfirmDialog = true;
  };

  private handleConfirmClose = async () => {
    await this.notifyCloseApi();
    this.isOpen = false;
    this.isMinimized = false;
    this.showConfirmDialog = false;
  };

  private handleCancelClose = () => {
    this.showConfirmDialog = false;
  };

  private formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private getUserDisplayName(): string {
    return this.userName?.trim() || "You";
  }

  private handleFeedback(messageId: string, type: 'up' | 'down') {
    if (this.feedbacks[messageId] === type) {
      const { [messageId]: _, ...rest } = this.feedbacks;
      this.feedbacks = rest;
    } else {
      this.feedbacks = {
        ...this.feedbacks,
        [messageId]: type
      };
    }
  }

  private toggleTheme = () => {
    const newTheme = this.theme === 'light' ? 'dark' : 'light';
    this.theme = newTheme;
    localStorage.setItem('chatbot-theme', newTheme);
  };

  private handleOptionClick = (option: string) => {
    if (this.inputRef) {
      const userMessage: Message = {
        content: option,
        sender: this.getUserDisplayName(),
        timestamp: new Date().toISOString()
      };

      this.messages = [...this.messages, userMessage];
      this.addBotReply(option);
      this.scrollToBottom();
    }
  };

  private renderMessage(message: Message) {
    const userDisplayName = this.getUserDisplayName();
    const isBot = message.sender !== userDisplayName;
    const messageId = `${message.timestamp}-${message.content.slice(0, 10)}`;

    if (message.isOptions) {
      return (
        <div class="quick-options-container">
          {this.getDefaultOptions().map((option) => (
            <button
              class="quick-option"
              onClick={() => this.handleOptionClick(option)}
            >
              {option}
            </button>
          ))}
        </div>
      );
    }

    return (
      <div class={`chat-message ${message.sender === userDisplayName ? "user" : "bot"}`}>
        <div class="message-container">
          <span class="message-timestamp">
            {isBot ? "Bot " : "You "} {this.formatTime(message.timestamp || new Date().toISOString())}
          </span>
          <div class="message-bubble" innerHTML={isBot ? sentenceFormatting(message.content).outerHTML : message.content}>

          {isBot && (
            <div class="message-feedback">
              <button
                class={`feedback-button ${this.feedbacks[messageId] === 'up' ? 'selected' : ''}`}
                onClick={() => this.handleFeedback(messageId, 'up')}
                title="Helpful"
              >
                👍
              </button>
              <button
                class={`feedback-button ${this.feedbacks[messageId] === 'down' ? 'selected' : ''}`}
                onClick={() => this.handleFeedback(messageId, 'down')}
                title="Not Helpful"
              >
                👎
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    );
  }

  render() {
    const style = {
      "--primary-color": this.primaryColor,
      "--secondary-color": this.secondaryColor,
    };

    return [
      <div style={style}>
        <button
          onClick={this.toggleChat}
          class={`chat-toggle-btn position-${this.position} ${
            this.isHidden ? "hidden" : ""
          }`}
          title={
            !this.isOpen
              ? "Open chat"
              : this.isMinimized
              ? "Maximize chat"
              : "Minimize chat"
          }
        >
          <img src={this.startChatLogo} alt="Chat" class="toggle-icon" />
        </button>
        ,
        <div
          class={`chat-container ${this.isOpen ? "open" : ""}  ${
            this.isMinimized ? "minimized" : ""
          }  ${this.isHidden ? "hidden" : ""} theme-${this.theme} position-${
            this.position
          }`}
        >
          <div
            class={`popup-overlay ${this.showConfirmDialog ? "active" : ""}`}
          >
            <div class="popup-content">
              <div class="popup-title">
                Are you sure you want to close the chat?
              </div>
              <div class="popup-buttons">
                <button
                  class="popup-button cancel"
                  onClick={this.handleCancelClose}
                >
                  Cancel
                </button>
                <button
                  class="popup-button confirm"
                  onClick={this.handleConfirmClose}
                >
                  Close
                </button>
              </div>
            </div>
          </div>

          <div class="chat-header">
            <img
              src={
                this.headerIcon
                  ? this.headerIcon
                  : "https://cdn-icons-png.flaticon.com/512/2068/2068710.png"
              }
              class="header-icon"
              alt=""
            />
            <span>{this.headerText}</span>
            <div class="header-controls">
              <button
                class="header-button theme-toggle"
                onClick={this.toggleTheme}
                title={`Switch to ${this.theme === 'light' ? 'dark' : 'light'} mode`}
              >
                {this.theme === 'light' ? '🌙' : '☀️'}
              </button>
              <button
                class="header-button"
                onClick={this.hideChat}
                title="Hide chat"
              >
                -
              </button>
              <button class="header-button" onClick={this.closeChat}>
                ×
              </button>
            </div>
          </div>

          <div class="messages">
            {this.messages.map((message) => (
              <Fragment>{this.renderMessage(message)}</Fragment>
            ))}

            {this.isLoading && (
              <div class="loading-dots">
                <div class="dot"></div>
                <div class="dot"></div>
                <div class="dot"></div>
              </div>
            )}
          </div>

          <div class="chat-controls">
            <div class="input-container">
              <input
                ref={(el) => (this.inputRef = el as HTMLInputElement)}
                type="text"
                placeholder={
                  this.isLoading
                    ? "Please wait for response..."
                    : this.inputPlaceholder
                }
                onKeyPress={this.handleSendMessage.bind(this)}
                disabled={this.isLoading}
              />
              <button
                class="send-button"
                onClick={(e) => this.handleSendMessage(e)}
                disabled={this.isLoading}
              >
                →
              </button>
            </div>
          </div>
        </div>
      </div>,
    ];
  }
}
