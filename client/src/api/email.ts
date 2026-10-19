import { apiClient } from './client';
import type {
  EmailTemplate,
  TemplateInput,
  SendEmailInput,
  SendResult,
  SendStatus,
  RecipientMetric,
} from '../features/email/types';

export function listTemplates(): Promise<EmailTemplate[]> {
  return apiClient.get<EmailTemplate[]>('/email/templates');
}

export function createTemplate(input: TemplateInput): Promise<EmailTemplate> {
  return apiClient.post<EmailTemplate>('/email/templates', input);
}

export function updateTemplate(
  id: string,
  input: Partial<TemplateInput>,
): Promise<EmailTemplate> {
  return apiClient.put<EmailTemplate>(`/email/templates/${id}`, input);
}

export function deleteTemplate(id: string): Promise<void> {
  return apiClient.delete<void>(`/email/templates/${id}`);
}

export function sendEmail(input: SendEmailInput): Promise<SendResult> {
  return apiClient.post<SendResult>('/email/send', input);
}

export function getSendStatus(): Promise<SendStatus> {
  return apiClient.get<SendStatus>('/email/send-status');
}

export function getRecipientMetrics(): Promise<RecipientMetric[]> {
  return apiClient.get<RecipientMetric[]>('/email/recipient-metrics');
}
