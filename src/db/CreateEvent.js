import mongoose from 'mongoose';

const eventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true },
    webhookUrl: { type: String } 
  },
  {
    timestamps: true,
  }
);

const EventModel = mongoose.model('Event', eventSchema);

export default EventModel;

