interface ErrorAlertProps {
  message: string;
}

export default function ErrorAlert({ message }: ErrorAlertProps) {
  if (!message) return null;

  return (
    <div className="p-3 rounded-lg bg-red-50 border border-red-200">
      <p className="text-sm text-red-600">{message}</p>
    </div>
  );
}