import mongoose from 'mongoose';

const ticketSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Event',
      required: true,
    },
    ticketuid: { type: String },
    name: { type: String },
    contactNumber: { type: String },
    qrcode: { type: String },
    qrCodeContent: { type: String },
    scanned: { type: Boolean, default: false },
    photo: { type: String },
  },
  {
    timestamps: true,
    strict: false,
  }
);

// Dynamically add fields 1 to 10
for (let i = 1; i <= 10; i++) {
  ticketSchema.add({ ['field' + i]: { type: String } });
}

const TicketModel = mongoose.model('Ticket', ticketSchema);

export default TicketModel;
