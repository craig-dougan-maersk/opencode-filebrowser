/**
 * Server ↔ TUI channel for the file browser. The server-side `filebrowser`
 * tool emits `open`; the TUI plugin subscribes and reveals or opens the file.
 *
 * Declared as a plain PortableDefinition because `register()` requires
 * JSON-Schema-shaped values.
 */
export const FilebrowserRpc = {
  id: "filebrowser",
  methods: {},
  events: {
    open: {
      schema: {
        type: "object",
        properties: {
          path: {
            type: "string"
          },
          mode: {
            type: "string",
            enum: ["reveal", "edit", "view"]
          }
        },
        required: ["path", "mode"],
        additionalProperties: false
      }
    }
  }
};
