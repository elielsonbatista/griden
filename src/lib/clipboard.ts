import { toast } from "sonner";

export async function copyText(text: string, successMessage = "Copiado") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
  } catch {
    toast.error("Não foi possível copiar", { duration: Infinity });
  }
}
