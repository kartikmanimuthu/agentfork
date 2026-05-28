import { Component, h, State } from '@stencil/core';
import { state, setPreChatDone, setSession } from '../../store/widget-store';
import { ApiService } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';

@Component({
  tag: 'smc-pre-chat-form',
  styleUrl: 'smc-pre-chat-form.css',
  shadow: true,
})
export class SmcPreChatForm {
  @State() values: Record<string, string> = {};
  @State() errors: Record<string, string> = {};
  @State() submitting = false;

  private handleInput = (field: string, value: string) => {
    this.values = { ...this.values, [field]: value };
    if (this.errors[field]) {
      const newErrors = { ...this.errors };
      delete newErrors[field];
      this.errors = newErrors;
    }
  };

  private async handleSubmit(e: Event) {
    e.preventDefault();
    const fields = state.config?.preChatForm ?? [];

    const errors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required && !this.values[field.field]?.trim()) {
        errors[field.field] = 'Required';
      }
      if (field.type === 'email' && this.values[field.field]) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.values[field.field])) {
          errors[field.field] = 'Invalid email';
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      this.errors = errors;
      return;
    }

    this.submitting = true;

    try {
      const widgetEl = document.querySelector('smc-chat-widget') as any;
      const sdkId = widgetEl?.sdkId;
      const storage = new StorageService(sdkId);
      const visitorId = storage.getVisitorId();
      const api = new ApiService(state.baseUrl, state.apiKey!);

      const session = await api.createSession({
        visitorId,
        visitorName: this.values['name'],
        visitorEmail: this.values['email'],
        metadata: this.values,
      });

      storage.setSessionId(session.id);
      storage.setPreChatDone(true);
      setSession({ id: session.id, status: 'active', visitorId });
      setPreChatDone(true);
    } catch {
      this.errors = { _form: 'Failed to start chat. Please try again.' };
    } finally {
      this.submitting = false;
    }
  }

  render() {
    const fields = state.config?.preChatForm ?? [];

    return (
      <div class="pre-chat">
        <div class="pre-chat-header">
          <h3>{state.config?.welcomeMessage ?? 'Welcome!'}</h3>
          <p>Please fill in your details to start chatting.</p>
        </div>
        <form onSubmit={(e) => this.handleSubmit(e)}>
          {fields.map((field) => (
            <div class="field">
              <label>{field.label ?? field.field}</label>
              {field.type === 'select' ? (
                <select onInput={(e) => this.handleInput(field.field, (e.target as HTMLSelectElement).value)}>
                  <option value="">Select...</option>
                  {(field.options ?? []).map((opt) => (
                    <option value={opt}>{opt}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : 'text'}
                  placeholder={field.label ?? field.field}
                  value={this.values[field.field] ?? ''}
                  onInput={(e) => this.handleInput(field.field, (e.target as HTMLInputElement).value)}
                />
              )}
              {this.errors[field.field] ? <span class="error">{this.errors[field.field]}</span> : null}
            </div>
          ))}
          {this.errors['_form'] ? <div class="form-error">{this.errors['_form']}</div> : null}
          <button type="submit" class="submit-btn" disabled={this.submitting}>
            {this.submitting ? 'Starting...' : 'Start Chat'}
          </button>
        </form>
      </div>
    );
  }
}
