import mongoose from 'mongoose';

const scannedSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
    ticket: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true },
    scanned: { type: Boolean, default: false }, 
    checkInTime: { type: Date },
  },
  {
    timestamps: true,
  }
);

const ScannedModel = mongoose.model('ScannedTicket', scannedSchema);

export default ScannedModel;

